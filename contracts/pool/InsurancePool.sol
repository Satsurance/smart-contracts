// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IPoolFactory} from "../interfaces/IPoolFactory.sol";
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

event GuardianUpdated(
    address indexed oldGuardian,
    address indexed newGuardian
);

event PoolPositionExtended(
    address indexed user,
    uint positionId,
    uint fromEpisode,
    uint toEpisode,
    uint sharesWithdrawn,
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
    uint public constant MINIMUM_STAKE_AMOUNT_BTC = 9500000000000; // $1 in BTC

    uint public poolId;
    IPoolFactory public factory;
    ICoverNFT public coverNFT;
    IPositionNFT public positionNFT;

    address public protocolRewardsAddress;
    ICapitalPool public capitalPool;
    address public reinvestPool;
    address public claimer;
    address public guardian;
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

    uint public minimumStakeAmount;

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

    modifier onlyGuardian() {
        require(msg.sender == guardian, "Only guardian can call");
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
        uint underwriterFee_
    ) public initializer {
        require(underwriterFee_ <= MAX_UNDERWRITER_FEE, "Underwriter fee too high");

        __Ownable_init(governor_);
        __Pausable_init();
        factory = IPoolFactory(msg.sender);
        poolId = factory.poolCount();
        coverNFT = ICoverNFT(factory.coverNFT());
        positionNFT = IPositionNFT(factory.positionNFT());
        updateGlobalSettings();

        poolUnderwriter = poolUnderwriter_;
        claimer = claimer_;
        poolAsset = IERC20(poolAsset_);

        totalAssetsStaked = 0;
        totalPoolShares = 0;
        isNewDepositAccepted = isNewDepositAccepted_;

        updatedRewardsAt = block.timestamp;
        minUnderwriterPercentage = minUnderwriterPercentage_;
        minimumStakeAmount = MINIMUM_STAKE_AMOUNT_BTC;
        bonusPerEpisodeStaked = bonusPerEpisodeStaked_;
        underwriterFee = underwriterFee_;
    }

    function updateClaimer(address newClaimer_) onlyOwner external {
        require(newClaimer_ != address(0), "New claimer cannot be zero address");
        claimer = newClaimer_;
    }

    function pause() external onlyGuardian {
        _pause();
    }

    function unpause() external onlyGuardian {
        _unpause();
    }

    function updateGlobalSettings() public {
        protocolRewardsAddress = factory.protocolRewardsAddress();
        capitalPool = ICapitalPool(factory.capitalPool());
        protocolFee = factory.protocolFee();
        guardian = factory.guardian();
        require(protocolFee <= MAX_PROTOCOL_FEE, "Protocol fee too high");

        emit GlobalSettingsUpdated(
            protocolRewardsAddress,
            protocolFee
        );
    }

    function rewardRatePerShare(uint updatedRewardsAt_, uint finishTime_) public view returns (uint) {
        if(totalAssetsStaked == 0 || totalPoolShares == 0) {
            return poolRewardRate;
        }
        return (poolRewardRate * (finishTime_ - updatedRewardsAt_) * 1e18)/totalRewardShares;
    }

    function _updateEpisodesState() internal {
        if(block.timestamp == updatedRewardsAt) {
            return;
        }
        uint currentEpisode = getCurrentEpisode();
        uint lastUpdatedEpisode = updatedRewardsAt / EPISODE_DURATION;
        uint updatedRewardsAt_ = updatedRewardsAt;
        // Episodes will have additional capital pool rewads, but it is fair
        for (uint i = lastUpdatedEpisode; i < currentEpisode; i++) {
            uint prevEpisodeFinishTime = getEpisodeFinishTime(i);

            accumulatedRewardRatePerShare += rewardRatePerShare(updatedRewardsAt_, prevEpisodeFinishTime);
            updatedRewardsAt_ = prevEpisodeFinishTime;
            poolRewardRate -= episodes[i + 1].rewardDecrease;

            
            // Set for the expiring episode
            episodes[i].accRewardPerShareOnExpire = accumulatedRewardRatePerShare;
            if(episodes[i].episodeShares > 0) {
                episodes[i].assetsStaked = episodes[i].episodeShares * totalAssetsStaked / totalPoolShares; // Includes capital pool rewards
                
            }
            capitalPool.onHold(poolId, episodes[i].assetsStaked);
            

            // Remove expired episode from total pool count
            totalPoolShares -= episodes[i].episodeShares;
            totalAssetsStaked -= episodes[i].assetsStaked;
            totalCoverAllocation -= episodes[i].coverageDecrease;
            totalRewardShares -= episodes[i].rewardShares;
            // Collect underwriter fee
            positions[0].rewardsCollected += _earnedPosition(0);
            positions[0].rewardShares -= episodes[i].rewardShares * underwriterFee / BASIS_POINTS;
            positions[0].rewardPerShare = accumulatedRewardRatePerShare;
        }
        accumulatedRewardRatePerShare += rewardRatePerShare(updatedRewardsAt_, block.timestamp);
        updatedRewardsAt = block.timestamp;
    }

    function _updateProductAllocation(Product storage product) internal  {
        uint lastUpdatedEpisode = product.lastAllocationUpdate / EPISODE_DURATION;
        uint currentEpisode = getCurrentEpisode();
        if(lastUpdatedEpisode == currentEpisode) {
            return;
        }
        // If the last update is more than MAX_ACTIVE_EPISODES, all the coverages are expired
        if (currentEpisode - MAX_ACTIVE_EPISODES > lastUpdatedEpisode) {
            product.allocation = 0;
            product.lastAllocationUpdate = block.timestamp;
            return;
        }
        uint allocationCut = 0;
        for(uint i = lastUpdatedEpisode; i <= currentEpisode; i++) {
            allocationCut += episodeAllocationCut[product.productId][i];
        }
        product.allocation -= allocationCut;
        product.lastAllocationUpdate = block.timestamp;
    }

    function earnedPosition(uint positionId_) public returns (uint) {
        _updateEpisodesState();
        uint newRewards = _earnedPosition(positionId_);
        positions[positionId_].rewardsCollected += newRewards;
        return positions[positionId_].rewardsCollected;
    }

    function _earnedPosition(uint positionId_) internal view returns (uint) {
        PoolStake storage position = positions[positionId_];
        uint reward = 0;
        uint rewardPerShare = position.episode < getCurrentEpisode() ?  episodes[position.episode].accRewardPerShareOnExpire : accumulatedRewardRatePerShare;
        reward = (position.rewardShares * (rewardPerShare - position.rewardPerShare)) / 1e18;
        return reward;
    }

    function earnedPositions(uint[] memory positionsIds_) public returns (uint reward) {
        for(uint i = 0; i < positionsIds_.length; i++) {
            reward += earnedPosition(positionsIds_[i]);
        }
    }

    function getPoolPosition(uint positionId_) external view returns (PoolStake memory position) {
        return positions[positionId_];
    }

    function collectRewards(uint[] memory positionsIds_) external {
        uint reward = earnedPositions(positionsIds_);
        for(uint i = 0; i < positionsIds_.length; i++) {
            require((positionsIds_[i] == 0 && msg.sender == poolUnderwriter) || 
            (positionNFT.ownerOf(positionsIds_[i]) == msg.sender), "Only position owner can collect rewards");
            positions[positionsIds_[i]].rewardPerShare = accumulatedRewardRatePerShare;
        }
        if (reward > 0) {
            poolAsset.transfer(msg.sender, reward);
        }
    }

    function setNewDepositsFlag(bool isNewDepositAccepted_) external onlyUnderwriter {
        isNewDepositAccepted = isNewDepositAccepted_;
    }

    function setUnderwriterFee(uint underwriterFee_) external onlyUnderwriter {
        require(underwriterFee_ <= MAX_UNDERWRITER_FEE, "Underwriter fee too high");
        underwriterFee = underwriterFee_;
    }

    // Underwriter's part of the stake can't be less than 10%
    function maxSharesUserToStake() public view returns(uint) {
        if(minUnderwriterPercentage == 0) {
            return type(uint).max;
        }
        return (positions[underwriterPositionId].shares * BASIS_POINTS)/minUnderwriterPercentage - totalPoolShares;
    }

    // Underwriter's part of the stake can't be less than 10%
    function maxUnderwriterSharesToUnstake() public view returns(uint) {
        if(minUnderwriterPercentage == 0) {
            return type(uint).max;
        }
        return positions[underwriterPositionId].shares - (totalPoolShares * minUnderwriterPercentage)/BASIS_POINTS;
    }

    function joinPool(
        uint amount_,
        uint episodeToStake_
    ) external whenNotPaused returns (bool completed) {
        require(amount_ >= minimumStakeAmount, "Too small staking amount");
        require(msg.sender == poolUnderwriter || isNewDepositAccepted, "New deposits are not allowed");
        require(msg.sender != poolUnderwriter || underwriterPositionId == 0, "Underwriter can't have multiple positions");
        require(msg.sender == poolUnderwriter || underwriterPositionId != 0, "There is should be at least one underwriter position");

        uint currentEpisode = getCurrentEpisode();
        require(episodeToStake_ < currentEpisode + MAX_ACTIVE_EPISODES, "Too long staking time");
        require(episodeToStake_ >= currentEpisode, "Outdated episode to stake");
        require((episodeToStake_ - currentEpisode) % 3 == 2, "Staking episode must be a multiple of 3");

        _updateEpisodesState();

        uint newPositionId = positionNFT.mintPositionNFT(msg.sender, uint64(poolId));
        uint newShares = totalPoolShares == 0 ? amount_ : (amount_ * totalPoolShares) / totalAssetsStaked;
        uint newRewardShares = newShares + newShares * (episodeToStake_ - currentEpisode - 2) * bonusPerEpisodeStaked / BASIS_POINTS;
        require(msg.sender == poolUnderwriter || newShares <= maxSharesUserToStake(), "Underwriter position can't be less than allowed");
        if(msg.sender == poolUnderwriter) {
            underwriterPositionId = newPositionId;
            positions[0].episode = type(uint).max;
        }

        {
            uint underwriterRewardShares = (newRewardShares * underwriterFee) / (BASIS_POINTS - underwriterFee);
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


    // TODO RECHECK ALL THE LOGIC
    function extendPoolPosition(uint positionId_, uint episodeToStake_, uint sharesToWithdraw_, uint amountToDeposit_) external whenNotPaused returns (bool) {
        require(msg.sender == positionNFT.ownerOf(positionId_), "Only position owner can extend");
        require(msg.sender == poolUnderwriter || isNewDepositAccepted, "Extended deposits are not allowed");
        require((amountToDeposit_ == 0 && sharesToWithdraw_ >= 0)||(amountToDeposit_ > 0 && sharesToWithdraw_ == 0), "It is only possible to deposit or withdraw, not both");

        uint currentEpisode = getCurrentEpisode();
        require(episodeToStake_ < currentEpisode + MAX_ACTIVE_EPISODES, "Too long staking time");
        require(episodeToStake_ >= currentEpisode, "Outdated episode to stake");
        require((episodeToStake_ - currentEpisode) % 3 == 2, "Staking episode must be a multiple of 3");

        _updateEpisodesState();

        PoolStake storage position = positions[positionId_];
        require(msg.sender != poolUnderwriter || sharesToWithdraw_ <= maxUnderwriterSharesToUnstake(), "Underwriter position can't be less than allowed");
        require(position.episode < currentEpisode || sharesToWithdraw_ == 0, "It is possible to withdraw on extend only for the expired positions");

        uint fromEpisode = position.episode; // Capture original episode for event
        uint earnedRewards = 0;
        if(position.episode < currentEpisode) {
            // Calculate reward and also update the position reward per share
            earnedRewards = earnedPosition(positionId_);
            position.rewardPerShare = accumulatedRewardRatePerShare;
        }

        // Clean previous episode
        uint movedAssets = 0;
        uint withdrawAmount = 0;
        {
            Episode storage previouslyDepositedEpisode = episodes[position.episode];
            uint positionAssets = (position.shares * previouslyDepositedEpisode.assetsStaked) / previouslyDepositedEpisode.episodeShares;
            withdrawAmount = (sharesToWithdraw_ * previouslyDepositedEpisode.assetsStaked) / previouslyDepositedEpisode.episodeShares;
            movedAssets = positionAssets - withdrawAmount;
            previouslyDepositedEpisode.assetsStaked -= positionAssets;
            previouslyDepositedEpisode.episodeShares -= position.shares;
            previouslyDepositedEpisode.rewardShares -= position.rewardShares;
        }
        


        {
            uint newShares = 0;
            uint newRewardShares = 0;
            if(amountToDeposit_ > 0) {
                poolAsset.transferFrom(msg.sender, address(capitalPool), amountToDeposit_);
                capitalPool.deposit(poolId, amountToDeposit_, ICapitalPool.DepositType.Position);
                // Update moving assets
                newShares =  (amountToDeposit_ * totalPoolShares) / totalAssetsStaked;
                newRewardShares = newShares + newShares * (episodeToStake_ - currentEpisode - 2) * bonusPerEpisodeStaked / BASIS_POINTS;

                position.shares += newShares;
                position.rewardShares += newRewardShares;
                
                totalPoolShares += newShares;
                totalAssetsStaked += amountToDeposit_;
                totalRewardShares += newRewardShares;
                
            }
            require(msg.sender == poolUnderwriter || newRewardShares <= maxSharesUserToStake(), "Underwriter position can't be less than allowed");

            // Update new target episode
            Episode storage targetEpisode = episodes[episodeToStake_];
            targetEpisode.assetsStaked += (movedAssets + amountToDeposit_);
            targetEpisode.episodeShares += (position.shares - sharesToWithdraw_ + newShares);
            targetEpisode.rewardShares += (position.rewardShares + newRewardShares);
            position.shares -= sharesToWithdraw_;
        }

        // Only for the expired positions
        if(position.episode < currentEpisode) {
            totalPoolShares += position.shares - sharesToWithdraw_;
            totalAssetsStaked += movedAssets;
            totalRewardShares += position.rewardShares;
            capitalPool.reDeposit(poolId, movedAssets);
        }

        position.episode = episodeToStake_;

        if(withdrawAmount > 0 || earnedRewards > 0) {
            capitalPool.positionWithdraw(poolId, withdrawAmount, earnedRewards, msg.sender);
        }

        emit PoolPositionExtended(
            msg.sender,
            positionId_,
            fromEpisode,
            episodeToStake_,
            sharesToWithdraw_,
            withdrawAmount,
            totalPoolShares,
            totalAssetsStaked
        );

        return true;
    }

    function quitPoolPosition(uint positionId_) external whenNotPaused returns (bool completed) {
        address toRemove = msg.sender;
        uint currentEpisode = getCurrentEpisode();
        PoolStake memory position = positions[positionId_];
        require(toRemove == positionNFT.ownerOf(positionId_), "Only position owner can remove");
        require(position.active, "Position inactive");
        require(position.episode < currentEpisode, "Funds are timelocked");
        _updateEpisodesState();

        require(toRemove != poolUnderwriter ||
            position.shares <= maxUnderwriterSharesToUnstake(),
            "Underwriter position can't be less than allowed"
         );

        uint rewards = earnedPosition(positionId_);
        positions[positionId_].rewardPerShare = accumulatedRewardRatePerShare;
        // First calculate withdraw based on shares in the episode
        Episode storage episode = episodes[position.episode];
        uint positionAmount = (position.shares * episode.assetsStaked)/ episode.episodeShares;

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

        return true;
    }

    function executeClaim(
        address receiver_,
        uint amount_
    ) external whenNotPaused returns (bool completed) {
        // TODO: Add product based claim fee
        require(msg.sender == claimer, "Caller is not the claimer");
        _updateEpisodesState();
        uint currentEpisode = getCurrentEpisode();  

        for(uint i = currentEpisode; i < currentEpisode + MAX_ACTIVE_EPISODES; i++) {
            Episode storage episode = episodes[i];
            episode.assetsStaked -= (amount_ * episode.assetsStaked) / totalAssetsStaked;
        }
        totalAssetsStaked -= amount_;
        capitalPool.claimWithdraw(poolId, amount_, receiver_);

        emit ClaimExecuted(
            msg.sender,
            receiver_,
            amount_,
            totalAssetsStaked
        );
        return true;
    }

    function _rewardPool(uint amount_) internal {
        uint currentEpisode = getCurrentEpisode();
        uint currentEpisodeFinishTime = getEpisodeFinishTime(currentEpisode);

        // 1 year + leftover
        uint rewardDuration = EPISODE_DURATION * 12 + (currentEpisodeFinishTime - block.timestamp);
        uint rewardRateIncrease = amount_ / rewardDuration;
        poolRewardRate += rewardRateIncrease;

        Episode storage episode = episodes[currentEpisode + 13];
        episode.rewardDecrease += rewardRateIncrease;
    }

    function _verifyProductAllocation(uint startEpisode_, uint requestedAllocation_) internal view returns(bool) {
        uint availableAllocation = 0;
        uint currentEpisode = getCurrentEpisode();
        for(uint i = startEpisode_; i < currentEpisode + MAX_ACTIVE_EPISODES; i++) {
            Episode storage episode = episodes[i];
            // availableAllocation += episode.assetsStaked;
            availableAllocation += episode.episodeShares * totalAssetsStaked / totalPoolShares; // Include capital pool income
            if(availableAllocation >= requestedAllocation_) {
                return true;
            }
        }
        return true;
    }

    function purchaseCover(
        uint64 productId_,
        address coveredAccount_,
        uint coverageDuration_,
        uint coverageAmount_
    ) external whenNotPaused returns (bool completed) {
        Product storage product = products[productId_];
        require(product.active, "Product is not active");
        require(coverageDuration_ <= product.maxCoverageDuration, "Coverage duration is too long");
        require(coverageDuration_ >= 28 days, "Coverage duration is too short");
        require(coveredAccount_ != address(0), "Wrong address covered");

        _updateEpisodesState();
        _updateProductAllocation(product);

        // Check enough allocation
        {
            uint lastCoveredEpisode = (block.timestamp + coverageDuration_) / EPISODE_DURATION;
            uint requiredProductAllocation = ((coverageAmount_ + product.allocation) * BASIS_POINTS)/ product.maxPoolAllocationPercent;
            require(_verifyProductAllocation(lastCoveredEpisode, requiredProductAllocation), "Not enough assets to cover");
            episodeAllocationCut[productId_][lastCoveredEpisode] += coverageAmount_;
            product.allocation += coverageAmount_;

            totalCoverAllocation += coverageAmount_;
            episodes[lastCoveredEpisode].coverageDecrease += coverageAmount_;
        }

        // Calculate premium
        uint premiumAmount = (coverageDuration_ * product.annualPercent * coverageAmount_) / (365 days * BASIS_POINTS);
        uint protocolFeeAmount = premiumAmount * protocolFee / BASIS_POINTS;
        uint rewardAmount = premiumAmount - protocolFeeAmount;
        poolAsset.transferFrom(msg.sender, address(capitalPool), rewardAmount);
        poolAsset.transferFrom(msg.sender, protocolRewardsAddress, protocolFeeAmount);
        capitalPool.deposit(poolId, rewardAmount, ICapitalPool.DepositType.Reward);

        _rewardPool(rewardAmount);

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
        require(maxCoverageDuration_ < (MAX_ACTIVE_EPISODES -1) * EPISODE_DURATION, "Max coverage duration is too long");
        require(maxPoolAllocationPercent_ <= BASIS_POINTS, "Max pool allocation is too high");
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
        require(maxCoverageDuration_ < (MAX_ACTIVE_EPISODES -1) * EPISODE_DURATION, "Max coverage duration is too long");
        require(maxPoolAllocationPercent_ <= BASIS_POINTS, "Max pool allocation is too high");
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
}