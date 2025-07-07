// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IPoolFactory} from "../interfaces/IPoolFactory.sol";
import {IProtocolSettings} from "../interfaces/IProtocolSettings.sol";
import {ICoverNFT} from "../interfaces/ICoverNFT.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";
import {ICapitalPool} from "../interfaces/ICapitalPool.sol";
import {console} from "hardhat/console.sol";

event PoolJoined(
    uint endEpisode,
    address indexed user,
    uint positionId,
    uint depositAmount,
    uint sharesReceived,
    uint totalPoolSharesAfter,
    uint totalAssetsAfter
);

event PoolExited(
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
    uint totalAssetsAfter
);

event CoverPurchased(
    address indexed purchaser,
    address indexed account,
    uint coveredAmount,
    uint premiumAmount,
    uint startDate,
    uint endDate
);

event GlobalSettingsUpdated(
    address indexed protocolRewardsAddress,
    uint protocolFee
);

event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);

event PoolPositionExtended(
    address indexed user,
    uint positionId,
    uint fromEpisode,
    uint toEpisode,
    uint withdrawnAmount,
    uint totalPoolSharesAfter,
    uint totalAssetsAfter
);

struct PoolStake {
    uint episode;
    uint shares;
    uint rewardShares;
    uint rewardPerShare;
    uint rewardsCollected;
    bool active;
}

struct Episode {
    uint episodeShares;
    uint rewardShares;
    uint assetsStaked;
    uint rewardDecrease;
    uint coverageDecrease;
    uint accRewardPerShareOnExpire;
}

struct Product {
    string name;
    uint64 productId;
    uint64 annualPercent;
    uint64 maxCoverageDuration;
    uint64 maxPoolAllocationPercent;
    uint allocation;
    uint lastAllocationUpdate;
    bool active;
}

contract InsurancePool is OwnableUpgradeable, PausableUpgradeable {
    uint public constant MAX_PROTOCOL_FEE = 1500;
    uint public constant MAX_UNDERWRITER_FEE = 1000;
    uint256 public constant MAX_ACTIVE_EPISODES = 24;
    uint public constant EPISODE_DURATION = 91 days / 3;
    uint public constant BASIS_POINTS = 10000; // 100% in basis points
    uint public constant MINIMUM_STAKE_AMOUNT_BTC = 10000000000000; // $1 in BTC

    uint public poolId;
    IPoolFactory public factory;
    IProtocolSettings public protocolSettings;
    ICoverNFT public coverNFT;
    IPositionNFT public positionNFT;

    address public protocolRewardsAddress;
    ICapitalPool public capitalPool;
    address public reinvestPool;
    address public claimer;
    IERC20 public poolAsset;

    uint public totalAssetsStaked;
    uint public totalPoolShares;
    uint public totalRewardShares;
    uint public poolRewardRate;
    uint public bonusPerEpisodeStaked;

    uint public protocolFee;

    // Products tracking
    uint64 public productCounter;
    mapping(uint => Product) public products;
    mapping(uint => mapping(uint => uint)) public episodeAllocationCut; // productId => episode => allocationCut

    // Position tracking mapping
    mapping(uint => PoolStake) public positions;

    // Underwriters
    uint public minUnderwriterPercentage;
    address public poolUnderwriter;
    uint public underwriterPositionId;
    uint public underwriterFee;
    bool public isNewDepositAccepted;
    uint public underwriterFirstLoss;

    // Episodes functions
    mapping(uint => Episode) public episodes;

    uint public updatedRewardsAt;
    uint public accumulatedRewardRatePerShare;

    uint public totalCoverAllocation;

    /**
     * @dev Storage gap to allow for future upgrades
     * This reserves storage slots for future variables
     */
    uint256[50] private __gap;

    modifier onlyUnderwriter() {
        require(msg.sender == poolUnderwriter, "Access check failed");
        _;
    }

    constructor() payable {
        _disableInitializers();
    }

    function initialize(
        address poolUnderwriter_,
        address governor_,
        address poolAsset_,
        address claimer_,
        uint minUnderwriterPercentage_, // 1000 is 10%
        uint bonusPerEpisodeStaked_,
        bool isNewDepositAccepted_,
        uint underwriterFee_,
        uint underwriterFirstLoss_
    ) public initializer {
        require(
            underwriterFee_ <= MAX_UNDERWRITER_FEE,
            "Underwriter fee too high"
        );

        __Ownable_init(governor_);
        __Pausable_init();
        factory = IPoolFactory(msg.sender);
        poolId = factory.poolCount();
        protocolSettings = IProtocolSettings(factory.settings());
        coverNFT = ICoverNFT(protocolSettings.coverNFT());
        positionNFT = IPositionNFT(protocolSettings.positionNFT());
        updateGlobalSettings();

        poolUnderwriter = poolUnderwriter_;
        claimer = claimer_;
        poolAsset = IERC20(poolAsset_);

        totalAssetsStaked = 0;
        totalPoolShares = 0;
        isNewDepositAccepted = isNewDepositAccepted_;

        updatedRewardsAt = block.timestamp;
        minUnderwriterPercentage = minUnderwriterPercentage_;
        bonusPerEpisodeStaked = bonusPerEpisodeStaked_;
        underwriterFee = underwriterFee_;
        underwriterFirstLoss = underwriterFirstLoss_;
    }

    function updateClaimer(address newClaimer_) external onlyOwner {
        require(
            newClaimer_ != address(0),
            "New claimer cannot be zero address"
        );
        claimer = newClaimer_;
    }

    function updateGlobalSettings() public {
        protocolRewardsAddress = protocolSettings.protocolRewardsAddress();
        capitalPool = ICapitalPool(protocolSettings.capitalPool());
        protocolFee = protocolSettings.protocolFee();
        require(protocolFee <= MAX_PROTOCOL_FEE, "Protocol fee too high");

        emit GlobalSettingsUpdated(protocolRewardsAddress, protocolFee);
    }

    function rewardRatePerShare(
        uint updatedRewardsAt_,
        uint finishTime_
    ) public view returns (uint) {
        if (totalAssetsStaked == 0 || totalPoolShares == 0) {
            return poolRewardRate;
        }
        return
            (poolRewardRate * (finishTime_ - updatedRewardsAt_) * 1e18) /
            totalRewardShares;
    }

    function _updateEpisodesState() internal {
        if (block.timestamp == updatedRewardsAt) {
            return;
        }
        uint currentEpisode = getCurrentEpisode();
        uint lastUpdatedEpisode = updatedRewardsAt / EPISODE_DURATION;
        uint updatedRewardsAt_ = updatedRewardsAt;
        totalAssetsStaked = capitalPool.getPoolValue(poolId);

        for (uint i = lastUpdatedEpisode; i < currentEpisode; i++) {
            uint prevEpisodeFinishTime = getEpisodeFinishTime(i);

            accumulatedRewardRatePerShare += rewardRatePerShare(
                updatedRewardsAt_,
                prevEpisodeFinishTime
            );
            updatedRewardsAt_ = prevEpisodeFinishTime;
            poolRewardRate -= episodes[i + 1].rewardDecrease;

            // Set for the expiring episode
            episodes[i]
                .accRewardPerShareOnExpire = accumulatedRewardRatePerShare;
            if (episodes[i].episodeShares > 0) {
                episodes[i].assetsStaked =
                    (episodes[i].episodeShares * totalAssetsStaked) /
                    totalPoolShares; // Includes capital pool rewards
                capitalPool.onHold(poolId, episodes[i].assetsStaked);
            }

            // Collect underwriter fee
            positions[0].rewardsCollected += _earnedPosition(0);
            positions[0].rewardShares -=
                (episodes[i].rewardShares * underwriterFee) /
                BASIS_POINTS;
            positions[0].rewardPerShare = accumulatedRewardRatePerShare;

            // Remove expired episode from total pool count
            totalPoolShares -= episodes[i].episodeShares;
            totalAssetsStaked -= episodes[i].assetsStaked;
            totalCoverAllocation -= episodes[i].coverageDecrease;
            totalRewardShares -= episodes[i].rewardShares;
        }
        accumulatedRewardRatePerShare += rewardRatePerShare(
            updatedRewardsAt_,
            block.timestamp
        );
        updatedRewardsAt = block.timestamp;
    }

    function _updateProductAllocation(Product storage product) internal {
        product.allocation = _computeCurrentProductAllocation(product);
        product.lastAllocationUpdate = block.timestamp;
    }

    function _computeCurrentProductAllocation(
        Product storage product
    ) internal view returns (uint) {
        uint lastUpdatedEpisode = product.lastAllocationUpdate /
            EPISODE_DURATION;
        uint currentEpisode = getCurrentEpisode();

        if (lastUpdatedEpisode == currentEpisode) {
            return product.allocation;
        }

        // If the last update is more than MAX_ACTIVE_EPISODES, all the coverages are expired
        if (currentEpisode - MAX_ACTIVE_EPISODES > lastUpdatedEpisode) {
            return 0;
        }

        uint allocationCut = 0;
        for (uint i = lastUpdatedEpisode; i <= currentEpisode; i++) {
            allocationCut += episodeAllocationCut[product.productId][i];
        }

        return product.allocation - allocationCut;
    }

    function earnedPosition(uint positionId_) public returns (uint) {
        _updateEpisodesState();
        uint newRewards = _earnedPosition(positionId_);
        positions[positionId_].rewardsCollected += newRewards;
        positions[positionId_].rewardPerShare = accumulatedRewardRatePerShare;
        return positions[positionId_].rewardsCollected;
    }

    function _earnedPosition(uint positionId_) internal view returns (uint) {
        PoolStake storage position = positions[positionId_];
        uint reward = 0;
        uint rewardPerShare = position.episode < getCurrentEpisode()
            ? episodes[position.episode].accRewardPerShareOnExpire
            : accumulatedRewardRatePerShare;
        reward =
            (position.rewardShares *
                (rewardPerShare - position.rewardPerShare)) /
            1e18;
        return reward;
    }

    function earnedPositions(
        uint[] memory positionsIds_
    ) public returns (uint reward) {
        for (uint i = 0; i < positionsIds_.length; i++) {
            reward += earnedPosition(positionsIds_[i]);
        }
    }

    function getPoolPosition(
        uint positionId_
    ) external view returns (PoolStake memory position) {
        return positions[positionId_];
    }

    function collectRewards(uint[] memory positionsIds_) external {
        uint reward = earnedPositions(positionsIds_);
        for (uint i = 0; i < positionsIds_.length; i++) {
            require(
                (positionsIds_[i] == 0 && msg.sender == poolUnderwriter) ||
                    (positionNFT.ownerOf(positionsIds_[i]) == msg.sender),
                "Only position owner can collect rewards"
            );
            positions[positionsIds_[i]].rewardsCollected = 0;
        }
        if (reward > 0) {
            capitalPool.positionWithdraw(poolId, 0, reward, msg.sender);
        }
    }

    function setNewDepositsFlag(
        bool isNewDepositAccepted_
    ) external onlyUnderwriter {
        isNewDepositAccepted = isNewDepositAccepted_;
    }

    function setUnderwriterFee(uint underwriterFee_) external onlyUnderwriter {
        require(
            underwriterFee_ <= MAX_UNDERWRITER_FEE,
            "Underwriter fee too high"
        );
        _updateEpisodesState();

        // Collect previous rewards
        positions[0].rewardsCollected += _earnedPosition(0);
        positions[0].rewardPerShare = accumulatedRewardRatePerShare;

        // Update rewards shares for active episodes.
        uint currentEpisode = getCurrentEpisode();
        for (
            uint i = currentEpisode;
            i < currentEpisode + MAX_ACTIVE_EPISODES;
            i++
        ) {
            uint sharesToRemove = (episodes[i].rewardShares * underwriterFee) /
                BASIS_POINTS;
            episodes[i].rewardShares -= sharesToRemove;

            uint sharesToAdd = (episodes[i].rewardShares * underwriterFee_) /
                (BASIS_POINTS - underwriterFee_);

            positions[0].rewardShares -= sharesToRemove;
            positions[0].rewardShares += sharesToAdd;
            totalRewardShares -= sharesToRemove;
            totalRewardShares += sharesToAdd;
        }

        underwriterFee = underwriterFee_;
    }

    // Underwriter's part of the stake can't be less than 10%
    function maxSharesUserToStake() public view returns (uint) {
        if (minUnderwriterPercentage == 0) {
            return type(uint).max;
        }
        uint maxShares = (positions[underwriterPositionId].shares *
            BASIS_POINTS) /
            minUnderwriterPercentage -
            totalPoolShares;
        if (positions[underwriterPositionId].episode < getCurrentEpisode()) {
            maxShares -= positions[underwriterPositionId].shares;
        }
        return maxShares;
    }

    // Underwriter's part of the stake can't be less than 10%
    function maxUnderwriterSharesToUnstake() public view returns (uint) {
        if (minUnderwriterPercentage == BASIS_POINTS) {
            return type(uint).max;
        }
        uint _totalPoolShares = totalPoolShares;
        if (positions[underwriterPositionId].episode < getCurrentEpisode()) {
            _totalPoolShares += positions[underwriterPositionId].shares;
        }

        return
            (positions[underwriterPositionId].shares *
                BASIS_POINTS -
                minUnderwriterPercentage *
                _totalPoolShares) / (BASIS_POINTS - minUnderwriterPercentage);
    }

    function joinPool(
        uint amount_,
        uint episodeToStake_
    ) external whenNotPaused returns (bool completed) {
        require(
            amount_ >= MINIMUM_STAKE_AMOUNT_BTC,
            "Too small staking amount"
        );
        require(
            msg.sender == poolUnderwriter || isNewDepositAccepted,
            "New deposits are not allowed"
        );
        require(
            msg.sender != poolUnderwriter || underwriterPositionId == 0,
            "Underwriter can't have multiple positions"
        );
        require(
            msg.sender == poolUnderwriter || underwriterPositionId != 0,
            "There is should be at least one underwriter position"
        );

        uint currentEpisode = getCurrentEpisode();
        require(
            episodeToStake_ < currentEpisode + MAX_ACTIVE_EPISODES,
            "Too long staking time"
        );
        require(episodeToStake_ >= currentEpisode, "Outdated episode to stake");
        require(
            episodeToStake_ % 3 == 2,
            "Staking episode must be a multiple of 91 days"
        );

        _updateEpisodesState();

        uint newPositionId = positionNFT.mintPositionNFT(
            msg.sender,
            uint64(poolId)
        );
        uint newShares = totalPoolShares == 0
            ? amount_
            : (amount_ * totalPoolShares) / totalAssetsStaked;

        uint newRewardShares = newShares +
            (newShares *
                (episodeToStake_ - currentEpisode) *
                bonusPerEpisodeStaked) /
            BASIS_POINTS;
        require(
            msg.sender == poolUnderwriter ||
                newShares <= maxSharesUserToStake(),
            "Underwriter position can't be less than allowed"
        );
        if (msg.sender == poolUnderwriter) {
            underwriterPositionId = newPositionId;
            positions[0].episode = type(uint).max;
        }

        {
            uint underwriterRewardShares = (newRewardShares * underwriterFee) /
                (BASIS_POINTS - underwriterFee);
            positions[newPositionId] = PoolStake({
                episode: episodeToStake_,
                shares: newShares,
                rewardShares: newRewardShares,
                rewardPerShare: accumulatedRewardRatePerShare,
                rewardsCollected: 0,
                active: true
            });
            positions[0].rewardShares += underwriterRewardShares;
            newRewardShares += underwriterRewardShares;
        }

        Episode storage targetEpisode = episodes[episodeToStake_];
        targetEpisode.assetsStaked += amount_;
        targetEpisode.episodeShares += newShares;
        targetEpisode.rewardShares += newRewardShares;

        // Save position

        totalPoolShares += newShares;
        totalAssetsStaked += amount_;
        totalRewardShares += newRewardShares;

        poolAsset.transferFrom(msg.sender, address(capitalPool), amount_);
        capitalPool.deposit(poolId, amount_, ICapitalPool.DepositType.Position);

        emit PoolJoined(
            episodeToStake_,
            msg.sender,
            newPositionId,
            amount_,
            newShares,
            totalPoolShares,
            totalAssetsStaked
        );

        return true;
    }

    function extendPoolPosition(
        uint positionId_,
        uint episodeToStake_,
        uint withdrawAmount_,
        uint amountToDeposit_
    ) external whenNotPaused returns (bool) {
        require(
            msg.sender == positionNFT.ownerOf(positionId_),
            "Only position owner can extend"
        );
        require(
            msg.sender == poolUnderwriter || isNewDepositAccepted,
            "Extended deposits are not allowed"
        );
        require(
            (amountToDeposit_ == 0 && withdrawAmount_ >= 0) ||
                (amountToDeposit_ > 0 && withdrawAmount_ == 0),
            "It is only possible to deposit or withdraw, not both"
        );

        uint currentEpisode = getCurrentEpisode();
        require(
            episodeToStake_ < currentEpisode + MAX_ACTIVE_EPISODES,
            "Too long staking time"
        );
        require(episodeToStake_ >= currentEpisode, "Outdated episode to stake");
        require(
            episodeToStake_ % 3 == 2,
            "Staking episode must be a multiple of 91 days"
        );

        _updateEpisodesState();

        PoolStake storage position = positions[positionId_];
        Episode storage previouslyDepositedEpisode = episodes[position.episode];
        uint sharesToWithdraw = (withdrawAmount_ *
            previouslyDepositedEpisode.episodeShares) /
            previouslyDepositedEpisode.assetsStaked;
        require(
            position.episode <= episodeToStake_,
            "It is not allowed to extend into a earlier episode"
        );
        require(
            msg.sender != poolUnderwriter ||
                sharesToWithdraw <= maxUnderwriterSharesToUnstake(),
            "Underwriter position can't be less than allowed"
        );
        require(
            position.episode < currentEpisode || sharesToWithdraw == 0,
            "It is possible to withdraw on extend only for the expired positions"
        );

        uint fromEpisode = position.episode; // Capture original episode for event
        // Collect rewards
        earnedPosition(positionId_);

        uint positionAssets = 0;
        uint newRewardShares = 0;
        if (position.episode < currentEpisode) {
            positionAssets =
                (position.shares * previouslyDepositedEpisode.assetsStaked) /
                previouslyDepositedEpisode.episodeShares;
            uint movedAssets = positionAssets - withdrawAmount_;
            previouslyDepositedEpisode.assetsStaked -= positionAssets;
            previouslyDepositedEpisode.episodeShares -= position.shares;
            previouslyDepositedEpisode.rewardShares -= position.rewardShares;

            if (withdrawAmount_ > 0) {
                capitalPool.positionWithdraw(
                    poolId,
                    withdrawAmount_,
                    0,
                    msg.sender
                );
            }
            capitalPool.reDeposit(poolId, movedAssets);

            uint newShares = totalPoolShares == 0
                ? amountToDeposit_ + movedAssets
                : ((amountToDeposit_ + movedAssets) * totalPoolShares) /
                    totalAssetsStaked;
            require(
                msg.sender == poolUnderwriter ||
                    newShares <= maxSharesUserToStake(),
                "Underwriter position can't be less than allowed"
            );
            newRewardShares =
                newShares +
                (newShares *
                    (episodeToStake_ - currentEpisode - 2) *
                    bonusPerEpisodeStaked) /
                BASIS_POINTS;
            position.shares = newShares;
            position.rewardShares = newRewardShares;

            totalPoolShares += newShares;
            totalAssetsStaked += amountToDeposit_ + movedAssets;
            totalRewardShares += newRewardShares;
        } else {
            uint episodeAssets = (episodes[position.episode].episodeShares *
                totalAssetsStaked) / totalPoolShares;
            positionAssets =
                (position.shares * episodeAssets) /
                previouslyDepositedEpisode.episodeShares;
            previouslyDepositedEpisode.assetsStaked -= positionAssets;
            previouslyDepositedEpisode.episodeShares -= position.shares;
            previouslyDepositedEpisode.rewardShares -= position.rewardShares;

            uint newShares = (amountToDeposit_ * totalPoolShares) /
                totalAssetsStaked;
            require(
                msg.sender == poolUnderwriter ||
                    newShares <= maxSharesUserToStake(),
                "Underwriter position can't be less than allowed"
            );

            newRewardShares =
                newShares +
                (newShares *
                    (episodeToStake_ - currentEpisode - 2) *
                    bonusPerEpisodeStaked) /
                BASIS_POINTS;
            position.shares += newShares;
            position.rewardShares += newRewardShares;

            totalPoolShares += newShares;
            totalAssetsStaked += amountToDeposit_;
            totalRewardShares += newRewardShares;
        }

        // Add underwriter reward shares
        uint underwriterRewardShares = (newRewardShares * underwriterFee) /
            (BASIS_POINTS - underwriterFee);
        positions[0].rewardShares += underwriterRewardShares;
        totalRewardShares += underwriterRewardShares;

        // Update new target episode
        Episode storage targetEpisode = episodes[episodeToStake_];
        targetEpisode.assetsStaked += positionAssets + amountToDeposit_;
        targetEpisode.episodeShares += position.shares;
        targetEpisode.rewardShares += position.rewardShares;

        position.episode = episodeToStake_;

        if (amountToDeposit_ > 0) {
            poolAsset.transferFrom(
                msg.sender,
                address(capitalPool),
                amountToDeposit_
            );
            capitalPool.deposit(
                poolId,
                amountToDeposit_,
                ICapitalPool.DepositType.Position
            );
        }

        emit PoolPositionExtended(
            msg.sender,
            positionId_,
            fromEpisode,
            episodeToStake_,
            withdrawAmount_,
            totalPoolShares,
            totalAssetsStaked
        );

        return true;
    }

    function quitPoolPosition(
        uint positionId_
    ) external whenNotPaused returns (bool completed) {
        address toRemove = msg.sender;
        uint currentEpisode = getCurrentEpisode();
        PoolStake memory position = positions[positionId_];
        require(
            toRemove == positionNFT.ownerOf(positionId_),
            "Only position owner can remove"
        );
        require(position.active, "Position inactive");
        require(position.episode < currentEpisode, "Funds are timelocked");
        _updateEpisodesState();

        require(
            toRemove != poolUnderwriter ||
                position.shares <= maxUnderwriterSharesToUnstake(),
            "Underwriter position can't be less than allowed"
        );

        uint rewards = earnedPosition(positionId_);
        positions[positionId_].rewardPerShare = accumulatedRewardRatePerShare;
        // Calculate withdraw based on shares in the episode
        Episode storage episode = episodes[position.episode];
        uint positionAmount = (position.shares * episode.assetsStaked) /
            episode.episodeShares;

        // Clean episode
        episode.assetsStaked -= positionAmount;
        episode.episodeShares -= position.shares;
        episode.rewardShares -= position.rewardShares;

        positions[positionId_].active = false;

        emit PoolExited(
            toRemove,
            positionId_,
            positionAmount,
            position.shares,
            totalPoolShares,
            totalAssetsStaked
        );

        capitalPool.positionWithdraw(poolId, positionAmount, rewards, toRemove);
        positionNFT.burnPositionNFT(positionId_);

        return true;
    }

    function executeClaim(
        address receiver_,
        uint amount_
    ) external whenNotPaused returns (bool completed) {
        require(msg.sender == claimer, "Caller is not the claimer");
        _updateEpisodesState();
        uint currentEpisode = getCurrentEpisode();
        PoolStake storage underwriterPosition = positions[
            underwriterPositionId
        ];
        Episode storage underwriterEpisode = episodes[
            underwriterPosition.episode
        ];
        uint underwriterStake = (underwriterPosition.shares *
            underwriterEpisode.assetsStaked) / underwriterEpisode.episodeShares;
        uint totalAssetsStakedWithUnderwriterPosition = currentEpisode >
            underwriterPosition.episode
            ? underwriterEpisode.assetsStaked + totalAssetsStaked
            : totalAssetsStaked;
        uint maxUnderwriterStakeToBurn = (underwriterFirstLoss *
            totalAssetsStakedWithUnderwriterPosition) / BASIS_POINTS;
        if (underwriterStake < maxUnderwriterStakeToBurn) {
            maxUnderwriterStakeToBurn = underwriterStake;
        }

        uint underwriterBurn = amount_;
        uint leftToSlash = 0;

        // Determine actual underwriter burn amount and leftover to slash
        if (amount_ > maxUnderwriterStakeToBurn) {
            underwriterBurn = maxUnderwriterStakeToBurn;
            leftToSlash = amount_ - underwriterBurn;
        }

        if (underwriterBurn > 0) {
            uint sharesToBurn = (underwriterBurn *
                underwriterEpisode.episodeShares) /
                underwriterEpisode.assetsStaked;
            underwriterEpisode.episodeShares -= sharesToBurn;
            underwriterEpisode.assetsStaked -= underwriterBurn;
            underwriterPosition.shares -= sharesToBurn;

            // Update totals only if underwriter position is still active
            if (currentEpisode <= underwriterPosition.episode) {
                totalAssetsStaked -= underwriterBurn;
                totalPoolShares -= sharesToBurn;
            } else {
                // Make additional slash for the expired underwriter position
                uint underwriterAdditionalSlash = (leftToSlash *
                    underwriterEpisode.assetsStaked) /
                    (totalAssetsStaked + underwriterEpisode.assetsStaked);
                underwriterEpisode.assetsStaked -= underwriterAdditionalSlash;
                leftToSlash -= underwriterAdditionalSlash;
            }
        }

        if (leftToSlash > 0) {
            for (
                uint i = currentEpisode;
                i < currentEpisode + MAX_ACTIVE_EPISODES;
                i++
            ) {
                Episode storage episode = episodes[i];
                episode.assetsStaked -=
                    (leftToSlash * episode.assetsStaked) /
                    totalAssetsStaked;
            }
            totalAssetsStaked -= leftToSlash;
        }

        capitalPool.claimWithdraw(poolId, amount_, receiver_);
        emit ClaimExecuted(msg.sender, receiver_, amount_, totalAssetsStaked);
        return true;
    }

    function _rewardPool(uint amount_, uint coverageDuration_) internal {
        uint lastRewardEpisode = (block.timestamp + coverageDuration_) /
            EPISODE_DURATION;
        uint rewardDuration = getEpisodeFinishTime(lastRewardEpisode) -
            block.timestamp;
        uint rewardRateIncrease = amount_ / rewardDuration;
        poolRewardRate += rewardRateIncrease;

        Episode storage episode = episodes[lastRewardEpisode + 1];
        episode.rewardDecrease += rewardRateIncrease;
    }

    function _verifyProductAllocation(
        uint startEpisode_,
        uint requestedAllocation_
    ) internal view returns (bool) {
        uint availableAllocation = 0;
        uint currentEpisode = getCurrentEpisode();
        for (
            uint i = startEpisode_;
            i < currentEpisode + MAX_ACTIVE_EPISODES;
            i++
        ) {
            Episode storage episode = episodes[i];
            availableAllocation +=
                (episode.episodeShares * totalAssetsStaked) /
                totalPoolShares; // Include capital pool income
            if (availableAllocation >= requestedAllocation_) {
                return true;
            }
        }
        return false;
    }

    function purchaseCover(
        uint64 productId_,
        address coveredAccount_,
        uint coverageDuration_,
        uint coverageAmount_
    ) external whenNotPaused returns (bool completed) {
        Product storage product = products[productId_];
        require(product.active, "Product is not active");
        require(
            coverageDuration_ <= product.maxCoverageDuration,
            "Coverage duration is too long"
        );
        require(coverageDuration_ >= 28 days, "Coverage duration is too short");
        require(coveredAccount_ != address(0), "Wrong address covered");

        _updateEpisodesState();
        _updateProductAllocation(product);

        // Check enough allocation
        {
            uint lastCoveredEpisode = (block.timestamp + coverageDuration_) /
                EPISODE_DURATION;
            uint requiredProductAllocation = ((coverageAmount_ +
                product.allocation) * BASIS_POINTS) /
                product.maxPoolAllocationPercent;
            require(
                _verifyProductAllocation(
                    lastCoveredEpisode,
                    requiredProductAllocation
                ),
                "Not enough assets to cover"
            );
            episodeAllocationCut[productId_][
                lastCoveredEpisode
            ] += coverageAmount_;
            product.allocation += coverageAmount_;

            totalCoverAllocation += coverageAmount_;
            episodes[lastCoveredEpisode].coverageDecrease += coverageAmount_;
        }

        // Calculate premium
        uint premiumAmount = (coverageDuration_ *
            product.annualPercent *
            coverageAmount_) / (365 days * BASIS_POINTS);
        uint protocolFeeAmount = (premiumAmount * protocolFee) / BASIS_POINTS;
        uint rewardAmount = premiumAmount - protocolFeeAmount;
        poolAsset.transferFrom(msg.sender, address(capitalPool), rewardAmount);
        poolAsset.transferFrom(
            msg.sender,
            protocolRewardsAddress,
            protocolFeeAmount
        );
        capitalPool.deposit(
            poolId,
            rewardAmount,
            ICapitalPool.DepositType.Reward
        );

        _rewardPool(rewardAmount, coverageDuration_);

        coverNFT.mintCoverNFT(
            coveredAccount_,
            coverageAmount_,
            productId_,
            uint64(block.timestamp),
            uint64(block.timestamp + coverageDuration_),
            uint64(poolId)
        );

        emit CoverPurchased(
            msg.sender,
            coveredAccount_,
            coverageAmount_,
            premiumAmount,
            block.timestamp,
            block.timestamp + coverageDuration_
        );
        return true;
    }

    function createProduct(
        string calldata name_,
        uint64 annualPercent_,
        uint64 maxCoverageDuration_,
        uint64 maxPoolAllocationPercent_
    ) external onlyUnderwriter returns (uint) {
        require(
            maxCoverageDuration_ < (MAX_ACTIVE_EPISODES - 1) * EPISODE_DURATION,
            "Max coverage duration is too long"
        );
        require(
            maxPoolAllocationPercent_ <= BASIS_POINTS,
            "Max pool allocation is too high"
        );
        require(annualPercent_ > 0, "Annual premium must be greater than 0");

        uint64 productId = productCounter++;
        products[productId] = Product({
            name: name_,
            productId: productId,
            annualPercent: annualPercent_,
            maxCoverageDuration: maxCoverageDuration_,
            maxPoolAllocationPercent: maxPoolAllocationPercent_,
            allocation: 0,
            lastAllocationUpdate: block.timestamp,
            active: true
        });
        return productId;
    }

    function setProduct(
        uint productId_,
        uint64 annualPercent_,
        uint64 maxCoverageDuration_,
        uint64 maxPoolAllocationPercent_,
        bool active_
    ) external onlyUnderwriter {
        require(
            maxCoverageDuration_ < (MAX_ACTIVE_EPISODES - 1) * EPISODE_DURATION,
            "Max coverage duration is too long"
        );
        require(
            maxPoolAllocationPercent_ <= BASIS_POINTS,
            "Max pool allocation is too high"
        );
        require(annualPercent_ > 0, "Annual premium must be greater than 0");
        require(productId_ < productCounter, "Product ID is too high");

        Product storage product = products[productId_];
        product.annualPercent = annualPercent_;
        product.maxCoverageDuration = maxCoverageDuration_;
        product.maxPoolAllocationPercent = maxPoolAllocationPercent_;
        product.active = active_;
    }

    function getCurrentEpisode() public view returns (uint) {
        return (block.timestamp) / EPISODE_DURATION;
    }

    function getEpisodeStartTime(uint episodeId_) public pure returns (uint) {
        return episodeId_ * EPISODE_DURATION;
    }

    function getEpisodeFinishTime(uint episodeId_) public pure returns (uint) {
        return (episodeId_ + 1) * EPISODE_DURATION;
    }

    function pause() external {
        require(
            msg.sender == protocolSettings.guardian(),
            "Only guardian can call"
        );
        _pause();
    }

    function unpause() external {
        require(
            msg.sender == protocolSettings.guardian(),
            "Only guardian can call"
        );
        _unpause();
    }

    function poolStatsLatest()
        external
        returns (
            uint totalAssetsStaked_,
            uint totalPoolShares_,
            uint totalRewardShares_,
            uint poolRewardRate_,
            uint maxSharesUserToStake_,
            uint maxUnderwriterSharesToUnstake_
        )
    {
        _updateEpisodesState();
        totalAssetsStaked_ = totalAssetsStaked;
        totalPoolShares_ = totalPoolShares;
        totalRewardShares_ = totalRewardShares;
        poolRewardRate_ = poolRewardRate;
        maxSharesUserToStake_ = maxSharesUserToStake();
        maxUnderwriterSharesToUnstake_ = maxUnderwriterSharesToUnstake();
    }

    function getProductAllocation(uint productId_) external returns (uint) {
        _updateEpisodesState();
        _updateProductAllocation(products[productId_]);
        return products[productId_].allocation;
    }
}
