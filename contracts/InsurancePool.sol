// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";


event PoolJoined(
    address indexed user,
    uint positionId,
    uint depositAmount,
    uint sharesReceived,
    uint minStakeTime,
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
    uint minTimeStake;
    uint shares;
    uint initialAmount;
    bool active;
}

error InvalidSignature(uint256 index);

contract InsurancePool is OwnableUpgradeable, UUPSUpgradeable, EIP712Upgradeable {
    address public governor;
    address public claimer;
    IERC20 public poolAsset;

    uint public totalAssetsStaked;
    uint public totalPoolShares;
    mapping(uint => bool) public possibleMinStakeTimes;

    // User position track mappings
    mapping(address => mapping(uint => PoolStake)) public positions;
    mapping(address => uint) public positionCounter;
    mapping(address => uint) public userTotalShares;

    // Underwriters
    uint public minUnderwriterPercentage;
    address public poolUnderwriter;
    address public poolUnderwriterSigner;
    bool public isNewDepositsAccepted;


    // Scheduled unstake part
    mapping(address => uint) public addressUnstakedSchdl;
    uint public timegapToUnstake;
    uint public scheduledUnstakeFee;
    uint public minimumStakeAmount;

    // Episodes functions
    uint public episodsStartDate;
    uint public episodeDuration;
    mapping(uint => uint) public episodeRewardRate;

    uint public updatedRewardsAt;
    uint public rewardPerShareStored;
    mapping(address => uint) public userRewardPerTokenPaid;
    mapping(address => uint) public rewards;

    mapping(uint256 => bool) public coverIds;
    bytes32 private constant UNSTAKE_TYPEHASH = keccak256(
        "UnstakeRequest(address user,uint256 positionId,uint256 deadline)"
    );
    bytes32 private constant PURCHASE_COVERAGE_TYPEHASH = keccak256(
        "PurchaseCoverageRequest(uint256 coverId,address account,uint256 coverAmount,uint256 purchaseAmount,uint256 startDate,uint256 endDate,string description,uint256 deadline)"
    );

    constructor() payable {
        _disableInitializers();
    }

    function initialize(
        address _poolUnderwritter,
        address _poolUnderwritterSigner,
        address _governor,
        address _poolAsset,
        address _owner,
        address _claimer,
        uint _minUnderwriterPercentage, // 1000 is 10%
        bool _isNewDepositsAccepted
    ) public initializer {
        __Ownable_init(_owner);
        __EIP712_init("Insurance Pool", "1");

        poolUnderwriter =_poolUnderwritter;
        poolUnderwriterSigner = _poolUnderwritterSigner;
        governor = _governor;
        claimer = _claimer;
        poolAsset = IERC20(_poolAsset);
        totalAssetsStaked = 0;
        totalPoolShares = 0;
        isNewDepositsAccepted = _isNewDepositsAccepted;

        possibleMinStakeTimes[60 * 60 * 24 * 90] = true;
        possibleMinStakeTimes[60 * 60 * 24 * 180] = true;
        possibleMinStakeTimes[60 * 60 * 24 * 360] = true;
        episodeDuration = 90 days;
        episodsStartDate = block.timestamp;
        updatedRewardsAt = block.timestamp;
        timegapToUnstake = 1 weeks;
        minUnderwriterPercentage = _minUnderwriterPercentage;
        // TODO choose correct values
        scheduledUnstakeFee = 10000;
        minimumStakeAmount = 100000000;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override(UUPSUpgradeable) onlyOwner {}

    function updateContractLogic(
        address newImplementation,
        bytes memory data
    ) external {
        require(msg.sender == governor, "not authorized update call.");
        upgradeToAndCall(newImplementation, data);
    }

    function updateClaimer(address newClaimer) external {
        require(msg.sender == governor, "not authorized update call.");
        require(newClaimer != address(0), "New claimer cannot be zero address");
        claimer = newClaimer;
    }

    modifier onlyClaimer() {
        require(msg.sender == claimer, "Caller is not the claimer");
        _;
    }

    function _updateReward(address _account) internal {
        rewardPerShareStored = rewardPerToken();
        updatedRewardsAt = block.timestamp;

        if (_account != address(0)) {
            rewards[_account] = earned(_account);
            userRewardPerTokenPaid[_account] = rewardPerShareStored;
        }
    }

    function rewardPerToken() public view returns (uint) {
        if (totalAssetsStaked == 0) {
            return rewardPerShareStored;
        }

        return
            rewardPerShareStored +
            (rewardRate() * (block.timestamp - updatedRewardsAt) * 1e18) /
            totalPoolShares;
    }

    function rewardRate() public view returns (uint) {
        uint currentEpisode = (block.timestamp - episodsStartDate) /
            episodeDuration;
        uint lastUpdatedEpisode = (updatedRewardsAt - episodsStartDate) /
            episodeDuration;
        if (lastUpdatedEpisode == currentEpisode)
            return episodeRewardRate[currentEpisode];

        // Calculate transitional reward Rate
        uint accumulatedTimestamp = updatedRewardsAt;
        uint rewardRateAccumulator = 0;
        for (uint i = lastUpdatedEpisode; i < currentEpisode; i++) {
            uint prevEpisodFinishTime = (i + 1) *
                episodeDuration +
                episodsStartDate;
            rewardRateAccumulator +=
                (prevEpisodFinishTime - accumulatedTimestamp) *
                episodeRewardRate[i];
            accumulatedTimestamp = prevEpisodFinishTime;
        }
        rewardRateAccumulator +=
            (block.timestamp - accumulatedTimestamp) *
            episodeRewardRate[currentEpisode];

        return rewardRateAccumulator / (block.timestamp - updatedRewardsAt);
    }

    function earned(address _account) public view returns (uint) {
        return
            (((userTotalShares[_account]) *
                (rewardPerToken() - userRewardPerTokenPaid[_account])) / 1e18) +
            rewards[_account];
    }

    function getPoolPosition(address account, uint positionId) external view returns (PoolStake memory position) {
        return positions[account][positionId];
    }

    function getReward() external {
        _updateReward(address(msg.sender));
        uint reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            poolAsset.transfer(msg.sender, reward);
        }
    }

    function setNewDepositsFlag(bool _isNewDepositsAccepted) external {
        require(msg.sender == poolUnderwriter, "Access check fail.");
        isNewDepositsAccepted = _isNewDepositsAccepted;
    }

    // Underwriter's part of the stake can't be less then 10%
    function maxAmountUserToStake() public view returns(uint) {
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
        uint _minTimeStake
    ) external returns (bool completed) {
        require(
            possibleMinStakeTimes[_minTimeStake],
            "Not valid minimum time staking option."
        );
        require(_amount >= minimumStakeAmount, "Too small staking amount.");
        require(msg.sender == poolUnderwriter || _amount <= maxAmountUserToStake(), "Underwriter position can't be less than allowed.");
        require(msg.sender == poolUnderwriter || isNewDepositsAccepted, "New deposits are not allowed.");

        poolAsset.transferFrom(msg.sender, address(this), _amount);
        _updateReward(address(msg.sender));

        uint newShares = totalPoolShares == 0 ? _amount : (_amount * totalPoolShares) / totalAssetsStaked;
        uint newPositionId = positionCounter[msg.sender]++;
            positions[msg.sender][newPositionId] = PoolStake({
                startDate: block.timestamp,
                minTimeStake: _minTimeStake,
                shares: newShares,
                initialAmount: _amount,
                active: true
            });

        userTotalShares[msg.sender] += newShares;
        totalPoolShares += newShares;
        totalAssetsStaked += _amount;

        emit PoolJoined(
            msg.sender,
            newPositionId,
            _amount,
            newShares,
            _minTimeStake,
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

    function getScheduledUnstaked() external returns (bool completed) {
        uint witdrawAmount = addressUnstakedSchdl[msg.sender];
        addressUnstakedSchdl[msg.sender] = 0;
        poolAsset.transfer(msg.sender, witdrawAmount);
        return true;
    }



    function _verifySignature(
            bytes32 structHash,
            address user,
            uint8 v,
            bytes32 r,
            bytes32 s
        ) public view returns (bool) {
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, v, r, s);
        return signer == user;
    }

    function scheduledUnstake(
        address[] memory toUnstakeAddrs, uint[] memory positionsIds, uint[] memory deadlines,
        uint8[] memory v, bytes32[] memory r, bytes32[] memory s
    ) external {
        for(uint i = 0; i < toUnstakeAddrs.length; i++) {
            require(block.timestamp <= deadlines[i], "Signature expired");
            bytes32 structHash = keccak256(
                abi.encode(
                    UNSTAKE_TYPEHASH,
                    toUnstakeAddrs[i],
                    positionsIds[i],
                    deadlines[i]
                )
            );
            require(
                _verifySignature(
                    structHash,
                    toUnstakeAddrs[i],
                    v[i],
                    r[i],
                    s[i]
                ),
                InvalidSignature(i)
            );
            uint withdrawAmount = _removePoolPosition(toUnstakeAddrs[i], positionsIds[i]);
            addressUnstakedSchdl[toUnstakeAddrs[i]] += withdrawAmount - scheduledUnstakeFee;
        }
        // Reward unstaker for work.
        poolAsset.transfer(msg.sender, scheduledUnstakeFee * toUnstakeAddrs.length);

    }

    function _removePoolPosition(address toRemove, uint positionId) internal returns(uint withdrawAmount) {
        PoolStake memory position = positions[toRemove][positionId];
        require(position.active, "Position inactive.");
        require(
            position.startDate +
            position.minTimeStake <
                block.timestamp,
            "Funds are timelocked, first lock."
        );
        require(
            position.minTimeStake == 0||
            (block.timestamp - position.startDate) % position.minTimeStake <= timegapToUnstake,
            "Funds are timelocked, auto-restake lock.");
        _updateReward(toRemove);


        // First calculate withdraw based on shares
        withdrawAmount = (position.shares * totalAssetsStaked) / totalPoolShares;
        require(toRemove != poolUnderwriter || withdrawAmount <= maxUnderwriterToUnstake(), "Underwriter position can't be less than allowed.");

        uint sharesToRedeem = position.shares;

        totalAssetsStaked -= withdrawAmount;
        totalPoolShares -= sharesToRedeem;
        userTotalShares[toRemove] -= sharesToRedeem;
        positions[toRemove][positionId].active = false;
        // Add leftovers to withdraw
        withdrawAmount += addressUnstakedSchdl[toRemove] + rewards[toRemove];
        addressUnstakedSchdl[toRemove] = 0;
        rewards[toRemove] = 0;

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
        _updateReward(address(0));
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
        _updateReward(address(0));
        uint currentEpisode = (block.timestamp - episodsStartDate) /
            episodeDuration;
        uint currentEpisodeFinishTime = (currentEpisode + 1) *
            episodeDuration +
            episodsStartDate;

        // Full reward duration is 1 year + time to finish current episode.
        uint rewardRatePerEpisode = amount / (episodeDuration * 4);
        episodeRewardRate[currentEpisode] += rewardRatePerEpisode;
        episodeRewardRate[currentEpisode + 1] += rewardRatePerEpisode;
        episodeRewardRate[currentEpisode + 2] += rewardRatePerEpisode;
        episodeRewardRate[currentEpisode + 3] += rewardRatePerEpisode;
        // It is needed to add leftovers awards
        episodeRewardRate[currentEpisode + 4] +=
            (rewardRatePerEpisode *
                (episodeDuration -
                    (currentEpisodeFinishTime - block.timestamp))) /
            episodeDuration;
    }

    function purchaseCover(
        uint coverId,
        address coverageAccount,
        uint coverageAmount,
        uint purchaseAmount,
        uint coverageStartDate,
        uint coverageEndDate,
        string calldata coverageDescription,
        uint deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (bool completed) {
        require(coverIds[coverId] == false, "The nonce was already used.");
        require(block.timestamp <= deadline, "Signarue expired.");
        require(coverageStartDate < coverageEndDate, "Wrong dates.");
        coverIds[coverId] = true;

        bytes32 structHash = keccak256(
            abi.encode(
                PURCHASE_COVERAGE_TYPEHASH,
                coverId,
                coverageAccount,
                coverageAmount,
                purchaseAmount,
                coverageStartDate,
                coverageEndDate,
                coverageDescription,
                deadline,
            )
        );
        require(
            _verifySignature(
                structHash,
                poolUnderwriterSigner,
                v,
                r,
                s
            ),
            InvalidSignature(0)
        );
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
}
