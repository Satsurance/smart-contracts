// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

struct PoolStake {
    uint startDate;
    uint minTimeStake;
    uint extendedAmount;
    uint initialAmount;
}

contract InsurancePool is OwnableUpgradeable, UUPSUpgradeable {
    address public governor;
    address public claimer;
    IERC20 public poolAsset;
    uint public SHARED_K;

    uint public totalAssetsStaked;
    mapping(uint256 => bool) public possibleMinStakeTimes;
    mapping(address => PoolStake) public addressAssets;
    // Temporary solution
    mapping(address => uint) public addressForcedUnstaked;

    // Episodes functions
    uint public episodsStartDate;
    uint public episodeDuration;
    mapping(uint => uint) public episodeRewardRate;

    uint public updatedRewardsAt;
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    constructor() payable {
        _disableInitializers();
    }

    function initialize(
        address _governor,
        address _poolAsset,
        address _owner,
        address _claimer
    ) public initializer {
        __Ownable_init(_owner);

        governor = _governor;
        claimer = _claimer;
        poolAsset = IERC20(_poolAsset);
        totalAssetsStaked = 0;
        // This one is for tests
        possibleMinStakeTimes[0] = true;
        possibleMinStakeTimes[60 * 60 * 24 * 90] = true;
        possibleMinStakeTimes[60 * 60 * 24 * 180] = true;
        possibleMinStakeTimes[60 * 60 * 24 * 365] = true;
        SHARED_K = 1 * 1e18; // initial koefficient * precision
        episodeDuration = 91 days;
        episodsStartDate = block.timestamp;
        updatedRewardsAt = block.timestamp;
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
        rewardPerTokenStored = rewardPerToken();
        updatedRewardsAt = block.timestamp;

        if (_account != address(0)) {
            rewards[_account] = earned(_account);
            userRewardPerTokenPaid[_account] = rewardPerTokenStored;
        }
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalAssetsStaked == 0) {
            return rewardPerTokenStored;
        }

        return
            rewardPerTokenStored +
            (rewardRate() * (block.timestamp - updatedRewardsAt) * 1e18) /
            totalAssetsStaked;
    }

    function rewardRate() public view returns (uint256) {
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

    function earned(address _account) public view returns (uint256) {
        return
            (((addressAssets[_account].extendedAmount / SHARED_K) *
                (rewardPerToken() - userRewardPerTokenPaid[_account])) / 1e18) +
            rewards[_account];
    }

    function getPoolPosition(
        address account
    ) external view returns (PoolStake memory position) {
        return addressAssets[account];
    }

    function joinPool(
        uint _amount,
        uint _minTimeStake
    ) external returns (bool completed) {
        require(
            addressAssets[msg.sender].startDate == 0,
            "User has already joined the pool."
        );
        require(
            possibleMinStakeTimes[_minTimeStake],
            "Not valid minimum time staking option."
        );
        poolAsset.transferFrom(msg.sender, address(this), _amount);
        _updateReward(address(msg.sender));
        addressAssets[msg.sender] = PoolStake(
            block.timestamp,
            _minTimeStake,
            _amount * SHARED_K,
            _amount
        );
        totalAssetsStaked += _amount;
        return true;
    }

    function quitPool() external returns (bool completed) {
        require(
            addressAssets[msg.sender].startDate != 0,
            "User hasn't joined the pool."
        );
        require(
            addressAssets[msg.sender].startDate +
                addressAssets[msg.sender].minTimeStake <
                block.timestamp,
            "Funds are timelocked."
        );
        _updateReward(msg.sender);

        uint withdrawAmount = ((addressAssets[msg.sender].extendedAmount /
            SHARED_K) & 0xffffffffffffffffffffffffffffff00) + // Remove small overcalculations
            addressForcedUnstaked[msg.sender];

        totalAssetsStaked -= withdrawAmount;
        withdrawAmount += rewards[msg.sender];
        delete addressAssets[msg.sender];
        addressForcedUnstaked[msg.sender] = 0;
        rewards[msg.sender] = 0;

        poolAsset.transfer(msg.sender, withdrawAmount);
        return true;
    }

    // Temporary solution to unstake funds with finished stake period in a forced way.
    // It might be done by bot to decrease a potential risk of big unstake in a case of claim event.
    // The mature approach will have auto-update feature with unstake scheduling.
    function forceUnstake(address[] memory toUnstakeAddrs) external {
        for (uint i = 0; i < toUnstakeAddrs.length; i++) {
            require(
                addressAssets[toUnstakeAddrs[i]].startDate +
                    addressAssets[msg.sender].minTimeStake <
                    block.timestamp,
                "Funds are timelocked."
            );
            _updateReward(toUnstakeAddrs[i]);
            uint unstakeAmount = addressAssets[toUnstakeAddrs[i]]
                .extendedAmount / SHARED_K;
            totalAssetsStaked -= unstakeAmount;
            delete addressAssets[toUnstakeAddrs[i]];
            addressForcedUnstaked[toUnstakeAddrs[i]] += unstakeAmount;
        }
    }

    function rewardPool(uint amount) external returns (bool completed) {
        poolAsset.transferFrom(msg.sender, address(this), amount);
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
        return true;
    }

    function executeClaim(
        address receiver,
        uint amount
    ) external onlyClaimer returns (bool completed) {
        _updateReward(address(0));
        SHARED_K =
            (SHARED_K * totalAssetsStaked) /
            (totalAssetsStaked - amount);
        totalAssetsStaked -= amount;
        poolAsset.transfer(receiver, amount);
        return true;
    }
}
