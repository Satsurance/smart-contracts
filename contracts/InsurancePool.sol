// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

event PoolJoined(
    uint startEpisode,
    uint endEpisode,
    address indexed user,
    uint positionId,
    uint depositAmount,
    uint sharesReceived,
    uint totalPoolSharesAfter,
    uint totalAssetsAfter
);

event PoolQuitted(
    address indexed user,
    uint positionId,
    uint withdrawnAmount,
    uint sharesRedeemed,
    uint totalPoolSharesAfter,
    uint totalAssetsAfter
);

event ClaimExecuted(
    address indexed claimer,
    address indexed receiver,
    uint claimAmount,
    uint totalAssetsAfter,
    uint timestamp
);

event NewCover(
    address indexed purchaser,
    address indexed account,
    uint amount,
    uint startDate,
    uint endDate,
    string description
);

struct PoolStake {
    uint startDate;
    uint startEpisode;
    uint endEpisode;
    uint shares;
    bool active;
}

struct Episode {
    uint startDate;
    uint endDate;
    uint amountCovered;
    uint episodeShares;
    uint assetsStaked;
    mapping(address=>mapping(uint=>uint)) userPositionsShares;
    uint rewardDecrease;
    uint rewardRatePerShare;
}


contract InsurancePool is OwnableUpgradeable, UUPSUpgradeable, EIP712Upgradeable {
    address public claimer;
    IERC20 public poolAsset;

    uint public totalAssetsStaked;
    uint public totalPoolShares;
    uint public poolRewardRate;

    // User position track mappings
    mapping(address => mapping(uint => mapping(uint => uint))) public positionRewardPerShare; // position in episode
    mapping(address => mapping(uint => PoolStake)) public positions;
    mapping(address => uint) public positionCounter;
    mapping(address => uint) public userTotalShares;

    // Underwriters
    uint public minUnderwriterPercentage;
    address public poolUnderwriter;
    bool public isNewDepositsAccepted;

    uint public minimumStakeAmount;

    // Episodes functions
    uint public episodsStartDate;
    uint public episodeDuration;
    mapping(uint => Episode) public episodes;
    uint256 public constant MAX_ACTIVE_EPISODES = 9;


    uint public updatedRewardsAt;

    // Coverage tracking (from HEAD branch)
    mapping(uint256 => bool) public coverIds;

    constructor() payable {
        _disableInitializers();
    }

    function initialize(
        address _poolUnderwritter,
        address _governor,
        address _poolAsset,
        address _claimer,
        uint _minUnderwriterPercentage, // 1000 is 10%
        bool _isNewDepositsAccepted
    ) public initializer {
        __Ownable_init(_governor);
        __EIP712_init("Insurance Pool", "1");

        poolUnderwriter =_poolUnderwritter;
        claimer = _claimer;
        poolAsset = IERC20(_poolAsset);
        totalAssetsStaked = 0;
        totalPoolShares = 0;
        isNewDepositsAccepted = _isNewDepositsAccepted;

        episodeDuration = 91 days;
        episodsStartDate = block.timestamp;
        updatedRewardsAt = block.timestamp;
        minUnderwriterPercentage = _minUnderwriterPercentage;
        // TODO choose correct values
        minimumStakeAmount = 100000000;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override(UUPSUpgradeable) onlyOwner {}

    function updateContractLogic(
        address newImplementation,
        bytes memory data
    ) onlyOwner external {
        upgradeToAndCall(newImplementation, data);
    }

    function updateClaimer(address newClaimer) onlyOwner external {
        require(newClaimer != address(0), "New claimer cannot be zero address");
        claimer = newClaimer;
    }

    modifier onlyClaimer() {
        require(msg.sender == claimer, "Caller is not the claimer");
        _;
    }

    function episodeRewardRate(uint id, uint _updatedRewardsAt) public view returns (uint) {
        Episode storage ep = episodes[id];
        if(ep.assetsStaked == 0) {
            return 0;
        }
        uint prevEpisodFinishTime = getEpisodeFinishTime(id);
        return (poolRewardRate * (prevEpisodFinishTime - _updatedRewardsAt) * 1e18)/ep.episodeShares;
    }


    function _updateEpisodesState() internal {
        if(block.timestamp == updatedRewardsAt) {
            return;
        }
        uint currentEpisode = getCurrentEpisode();
        uint lastUpdatedEpisode = (updatedRewardsAt - episodsStartDate) /
            episodeDuration;

        uint _updatedRewardsAt = updatedRewardsAt;
        for (uint i = lastUpdatedEpisode; i < currentEpisode; i++) {
            uint prevEpisodFinishTime = getEpisodeFinishTime(i);

            Episode storage oldEp = episodes[i];
            oldEp.rewardRatePerShare += episodeRewardRate(i, _updatedRewardsAt);
            _updatedRewardsAt = prevEpisodFinishTime;

            poolRewardRate -= episodes[i + 1].rewardDecrease;
        }
        Episode storage ep = episodes[currentEpisode];
        ep.rewardRatePerShare += episodeRewardRate(currentEpisode, _updatedRewardsAt);
        updatedRewardsAt = block.timestamp;
    }


    function earnedPosition(address _account, uint _positionId, uint[] memory episodesId, bool update) public returns (uint) {
        _updateEpisodesState();
        PoolStake memory position = positions[_account][_positionId];
        uint reward = 0;
        for(uint i = 0; i < episodesId.length; i++) {
            uint episodeStartDate = getEpisodeStartTime(episodesId[i]);
            if(episodeStartDate > block.timestamp) {
                break;
            }
            Episode storage ep = episodes[episodesId[i]];
            require(ep.userPositionsShares[_account][_positionId] > 0, "The account is not a part of the episode.");
            
            reward += (position.shares * (ep.rewardRatePerShare - positionRewardPerShare[_account][_positionId][i]));
            if(update) {
                positionRewardPerShare[_account][_positionId][episodesId[i]] = ep.rewardRatePerShare;
            }
        }
        reward /= 1e18 ;
        return reward;
    }

    

    function earnedPositions(address _account, uint[] memory _positionsIds, uint[] memory episodesId, bool update) public returns (uint reward) {
        for(uint i = 0; i < _positionsIds.length; i++) {
            reward += earnedPosition(_account, _positionsIds[i], episodesId, update);
        }
    }

    function getPoolPosition(address account, uint positionId) external view returns (PoolStake memory position) {
        return positions[account][positionId];
    }

    function getReward(uint[] memory _positionsIds, uint[] memory episodesIds) external {
        _updateEpisodesState();
        uint reward = earnedPositions(msg.sender, _positionsIds, episodesIds, true);
        if (reward > 0) {
            poolAsset.transfer(msg.sender, reward);
        }
    }

    function setNewDepositsFlag(bool _isNewDepositsAccepted) external {
        require(msg.sender == poolUnderwriter, "Access check fail.");
        isNewDepositsAccepted = _isNewDepositsAccepted;
    }

    // Underwriter's part of the stake can't be less then 10%
    function maxAmountUserToStake() public view returns(uint) {
        if(totalPoolShares == 0) return 0;
        return ((((userTotalShares[poolUnderwriter] * 10000)/minUnderwriterPercentage) - totalPoolShares) * totalAssetsStaked) / totalPoolShares;
    }

    // Underwriter's part of the stake can't be less then 10%
    function maxUnderwriterToUnstake() public view returns(uint) {
        if(userTotalShares[poolUnderwriter] == totalPoolShares) {
            return totalAssetsStaked;
        }
        return ((userTotalShares[poolUnderwriter] - (totalPoolShares * minUnderwriterPercentage) / 10000) * totalAssetsStaked)/totalPoolShares;
    }

    function joinPool(
        uint _amount,
        uint _episodesToStake
    ) external returns (bool completed) {
        require(_amount >= minimumStakeAmount, "Too small staking amount.");
        require(msg.sender == poolUnderwriter || _amount <= maxAmountUserToStake(), "Underwriter position can't be less than allowed.");
        require(msg.sender == poolUnderwriter || isNewDepositsAccepted, "New deposits are not allowed.");
        require(_episodesToStake < MAX_ACTIVE_EPISODES, "Too long staking time.");

        poolAsset.transferFrom(msg.sender, address(this), _amount);
        _updateEpisodesState();

        uint newPositionId = positionCounter[msg.sender]++;
        uint currentEpisode = getCurrentEpisode();
        uint newShares = totalPoolShares == 0 ? _amount : (_amount * totalPoolShares) / totalAssetsStaked;
        {
            for(uint i = currentEpisode; i < currentEpisode + _episodesToStake; i++) {
                Episode storage ep = episodes[i];
                uint newEpisodeShares = ep.episodeShares == 0? _amount: (_amount * ep.episodeShares)/ep.assetsStaked;
                ep.episodeShares += newEpisodeShares;
                ep.userPositionsShares[msg.sender][newPositionId] = newEpisodeShares;
                ep.assetsStaked += _amount;
            }
        }
            positions[msg.sender][newPositionId] = PoolStake({
                startDate: block.timestamp,
                startEpisode: currentEpisode,
                endEpisode: currentEpisode + _episodesToStake,
                shares: newShares,
                active: true
            });

        userTotalShares[msg.sender] += newShares;
        totalPoolShares += newShares;
        totalAssetsStaked += _amount;

        emit PoolJoined(
            currentEpisode,
            currentEpisode + _episodesToStake,
            msg.sender,
            newPositionId,
            _amount,
            newShares,
            totalPoolShares,
            totalAssetsStaked
        );

        return true;
    }

    function quitPoolPosition(uint positionId) external returns (bool completed) {
        uint withdrawAmount = _removePoolPosition(msg.sender, positionId);
        poolAsset.transfer(msg.sender, withdrawAmount);
        return true;
    }


    function _removePoolPosition(address toRemove, uint positionId) internal returns(uint withdrawAmount) {
        uint currentEpisode = getCurrentEpisode();
        PoolStake memory position = positions[toRemove][positionId];
        require(position.active, "Position inactive.");
        require(position.endEpisode < currentEpisode, "Funds are timelocked.");
        _updateEpisodesState();


        // Tricky thing to get required episodes.
        uint[] memory episodesList = new uint256[](position.endEpisode - position.startEpisode );
        for (uint256 i = 0; i < episodesList.length; i++) episodesList[i] = position.startEpisode + i;

        uint prewards = earnedPosition(toRemove, positionId,episodesList, false);
        // First calculate withdraw based on shares in the last episode
        Episode storage ep = episodes[position.endEpisode - 1];
        withdrawAmount = (ep.userPositionsShares[toRemove][positionId]*ep.assetsStaked)/ ep.episodeShares;
        // withdrawAmount = (position.shares * totalAssetsStaked) / totalPoolShares;
        require(toRemove != poolUnderwriter || withdrawAmount <= maxUnderwriterToUnstake(), "Underwriter position can't be less than allowed.");


        // Old removals
        uint sharesToRedeem = position.shares;
        totalAssetsStaked -= withdrawAmount;
        totalPoolShares -= sharesToRedeem;
        userTotalShares[toRemove] -= sharesToRedeem;
        positions[toRemove][positionId].active = false;
        // Add leftovers to withdraw
        withdrawAmount += prewards;

        // New removals
        ep.assetsStaked -= withdrawAmount;
        ep.episodeShares -= ep.userPositionsShares[toRemove][positionId];
        ep.userPositionsShares[toRemove][positionId] = 0;

        emit PoolQuitted(
            toRemove,
            positionId,
            withdrawAmount,
            sharesToRedeem,
            totalPoolShares,
            totalAssetsStaked
        );
    }

    function executeClaim(
        address receiver,
        uint amount
    ) external onlyClaimer returns (bool completed) {
        _updateEpisodesState();
        uint currentEpisode = getCurrentEpisode();
        Episode storage ep = episodes[currentEpisode];
        for(uint i = currentEpisode; i < currentEpisode + MAX_ACTIVE_EPISODES; i++) {
            ep = episodes[i];
            if(episodes[i].assetsStaked == 0) {break;}
            ep.assetsStaked -= amount;
                
        }
        totalAssetsStaked -= amount;
        poolAsset.transfer(receiver, amount);

        emit ClaimExecuted(
            msg.sender,
            receiver,
            amount,
            totalAssetsStaked,
            block.timestamp
        );
        return true;
    }

    function _rewardPool(uint amount) internal {
        _updateEpisodesState();
        uint currentEpisode = getCurrentEpisode();
        uint currentEpisodeFinishTime = getEpisodeFinishTime(currentEpisode);

        Episode storage ep = episodes[currentEpisode];

        // 1 year + leftover
        uint rewardDuration = episodeDuration * 4 + (currentEpisodeFinishTime - block.timestamp);
        uint rewardRateIncrease = amount / rewardDuration;
        poolRewardRate += rewardRateIncrease;

        ep = episodes[currentEpisode + 5];
        ep.rewardDecrease += rewardRateIncrease;
    }

    function purchaseCover(
        uint coverId,
        address coverageAccount,
        uint coverageAmount,
        uint purchaseAmount,
        uint coverageStartDate,
        uint coverageEndDate,
        string calldata coverageDescription
    ) external returns (bool completed) {
        require(coverIds[coverId] == false, "The nonce was already used.");
        require(coverageStartDate < coverageEndDate, "Wrong dates.");
        coverIds[coverId] = true;


        poolAsset.transferFrom(msg.sender, address(this), purchaseAmount);
        _rewardPool(purchaseAmount);

        emit NewCover(
            msg.sender,
            coverageAccount,
            coverageAmount,
            coverageStartDate,
            coverageEndDate,
            coverageDescription
        );
        return true;
    }

    function getCurrentEpisode() public view returns (uint) {
        return (block.timestamp - episodsStartDate) / episodeDuration;
    }

    function getEpisodeStartTime(uint episodeId) public view returns (uint) {
        return episodeId * episodeDuration + episodsStartDate;
    }

    function getEpisodeFinishTime(uint episodeId) public view returns (uint) {
        return (episodeId + 1) * episodeDuration + episodsStartDate;
    }
}
