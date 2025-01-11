// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";


event PoolJoined(
    address indexed user,
    uint depositAmount,
    uint sharesReceived,
    uint minStakeTime,
    uint totalPoolSharesAfter,
    uint totalAssetsAfter
);

event PoolQuitted(
    address indexed user,
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

struct PoolStake {
    uint startDate;
    uint minTimeStake;
    uint shares;
    uint initialAmount;
}

contract InsurancePool is OwnableUpgradeable, UUPSUpgradeable {


    address public governor;
    address public claimer;
    IERC20 public poolAsset;

    uint public totalAssetsStaked;
    uint public totalPoolShares;
    mapping(uint => bool) public possibleMinStakeTimes;
    mapping(address => PoolStake) public addressPosition;
    // Temporary solution
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
        totalPoolShares = 0;
        // This one is for tests
        possibleMinStakeTimes[0] = true;
        possibleMinStakeTimes[60 * 60 * 24 * 90] = true;
        possibleMinStakeTimes[60 * 60 * 24 * 180] = true;
        possibleMinStakeTimes[60 * 60 * 24 * 360] = true;
        episodeDuration = 90 days;
        episodsStartDate = block.timestamp;
        updatedRewardsAt = block.timestamp;
        timegapToUnstake = 1 weeks;
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
            (((addressPosition[_account].shares) *
                (rewardPerToken() - userRewardPerTokenPaid[_account])) / 1e18) +
            rewards[_account];
    }

    function getPoolPosition(
        address account
    ) external view returns (PoolStake memory position) {
        return addressPosition[account];
    }

    function getReward() external {
        _updateReward(address(msg.sender));
        uint reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            poolAsset.transfer(msg.sender, reward);
        }
    }

    function joinPool(
        uint _amount,
        uint _minTimeStake
    ) external returns (bool completed) {
        require(
            addressPosition[msg.sender].startDate == 0,
            "User has already joined the pool."
        );
        require(
            possibleMinStakeTimes[_minTimeStake],
            "Not valid minimum time staking option."
        );
        require(_amount >= minimumStakeAmount, "Too small staking amount.");

        poolAsset.transferFrom(msg.sender, address(this), _amount);
        _updateReward(address(msg.sender));

        uint newShares;
        if (totalPoolShares == 0 || totalAssetsStaked == 0) {
            newShares = _amount;
        } else {
            newShares = (_amount * totalPoolShares) / totalAssetsStaked;
        }
        addressPosition[msg.sender] = PoolStake(
            block.timestamp,
            _minTimeStake,
            newShares,
            _amount
        );
        totalAssetsStaked += _amount;
        totalPoolShares += newShares;

        emit PoolJoined(
            msg.sender,
            _amount,
            newShares,
            _minTimeStake,
            totalPoolShares,
            totalAssetsStaked
        );
        return true;
    }

    function quitPool() external returns (bool completed) {
        uint withdrawAmount = _removePoolPosition(msg.sender);
        poolAsset.transfer(msg.sender, withdrawAmount);
        return true;
    }

    function scheduledUnstake(
        address[] memory toUnstakeAddrs, uint[] memory v, uint[] memory r, uint[] memory s
    ) external {
        // TODO make signed message verification
        for(uint i = 0; i < toUnstakeAddrs.length; i++) {
            uint withdrawAmount = _removePoolPosition(toUnstakeAddrs[i]);
            addressUnstakedSchdl[toUnstakeAddrs[i]] += withdrawAmount - scheduledUnstakeFee;
        }
        // Reward unstaker for work.
        poolAsset.transfer(msg.sender, scheduledUnstakeFee * toUnstakeAddrs.length);

    }

    function _removePoolPosition(address toRemove) internal returns(uint withdrawAmount) {
        require(
            addressPosition[toRemove].startDate != 0,
            "User hasn't joined the pool."
        );
        require(
            addressPosition[toRemove].startDate +
                addressPosition[toRemove].minTimeStake <
                block.timestamp,
            "Funds are timelocked, first lock."
        );
        require(
            (block.timestamp - addressPosition[toRemove].startDate)
                % addressPosition[toRemove].minTimeStake <= timegapToUnstake,
            "Funds are timelocked, auto-restake lock.");
        _updateReward(toRemove);

        withdrawAmount = (addressPosition[toRemove].shares *
            totalAssetsStaked) /
            totalPoolShares +
            addressUnstakedSchdl[toRemove];

        uint sharesToRedeem = addressPosition[toRemove].shares;

        totalAssetsStaked -= withdrawAmount;
        totalPoolShares -= sharesToRedeem;
        withdrawAmount += rewards[toRemove];
        delete addressPosition[toRemove];
        addressUnstakedSchdl[toRemove] = 0;
        rewards[toRemove] = 0;

        emit PoolQuitted(
            toRemove,
            withdrawAmount,
            sharesToRedeem,
            totalPoolShares,
            totalAssetsStaked
        );
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
}
