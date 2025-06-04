// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IPoolFactory} from "../interfaces/IPoolFactory.sol";
import {ICoverNFT} from "../interfaces/ICoverNFT.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";

event PoolJoined(
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
    uint totalAssetsAfter
);

event NewCover(
    address indexed purchaser,
    address indexed account,
    uint coveredAmount,
    uint premiumAmount,
    uint startDate,
    uint endDate
);

event GlobalSettingsUpdated(
    address indexed capitalPool,
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
    bool active;
}

struct Episode {
    uint episodeShares;
    uint rewardShares;
    uint assetsStaked;
    uint rewardDecrease;
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

    uint public poolId;
    IPoolFactory public factory;
    ICoverNFT public coverNFT;
    IPositionNFT public positionNFT;

    address public capitalPool;
    address public claimer;
    address public guardian;
    IERC20 public poolAsset;

    uint public totalAssetsStaked;
    uint public totalPoolShares;
    uint public totalRewardShares;
    uint public poolRewardRate;
    uint public bonusPerEpisodeStaked;

    uint public protocolFee;
    uint public constant BASIS_POINTS = 10000; // 100% in basis points


    // Products tracking
    uint64 public productCounter;
    mapping(uint => Product) public products;
    mapping(uint => mapping(uint => uint)) public episodeAllocationCut; // productId => episode => allocationCut

    // Position track mapping
    mapping(uint => PoolStake) public positions;

    // Underwriters
    uint public minUnderwriterPercentage;
    address public poolUnderwriter;
    bool public isNewDepositsAccepted;
    uint public underwriterTotalShares;
    uint public underwriterFee;


    uint public minimumStakeAmount;

    // Episodes functions
    mapping(uint => Episode) public episodes;

    uint public updatedRewardsAt;
    uint public accRewardRatePerShare;

    /**
     * @dev Storage gap to allow for future upgrades
     * This reserves storage slots for future variables
     */
    uint256[50] private __gap;

    constructor() payable {
        _disableInitializers();
    }

    function initialize(
        address poolUnderwritter,
        address governor,
        address poolAsset_,
        address claimer_,
        uint minUnderwriterPercentage_, // 1000 is 10%
        uint bonusPerEpisodeStaked_,
        bool isNewDepositsAccepted_,
        uint underwriterFee_
    ) public initializer {
        require(underwriterFee_ <= MAX_UNDERWRITER_FEE, "Underwriter fee too high.");

        __Ownable_init(governor);
        __Pausable_init();
        factory = IPoolFactory(msg.sender);
        poolId = factory.poolCount();
        coverNFT = ICoverNFT(factory.coverNFT());
        positionNFT = IPositionNFT(factory.positionNFT());
        updateGlobalSettings();

        poolUnderwriter = poolUnderwritter;
        claimer = claimer_;
        poolAsset = IERC20(poolAsset_);

        totalAssetsStaked = 0;
        totalPoolShares = 0;
        isNewDepositsAccepted = isNewDepositsAccepted_;

        updatedRewardsAt = block.timestamp;
        minUnderwriterPercentage = minUnderwriterPercentage_;
        // 1$ in BTC
        minimumStakeAmount = 9500000000000;
        bonusPerEpisodeStaked = bonusPerEpisodeStaked_;
        underwriterFee = underwriterFee_;


    }

    function updateClaimer(address newClaimer) onlyOwner external {
        require(newClaimer != address(0), "New claimer cannot be zero address");
        claimer = newClaimer;
    }


    function pause() external {
        require(msg.sender == guardian, "Only guardian can pause");
        _pause();
    }

    function unpause() external {
        require(msg.sender == guardian, "Only guardian can unpause");
        _unpause();
    }

    function updateGlobalSettings() public {
        capitalPool = factory.capitalPool();
        protocolFee = factory.protocolFee();
        guardian = factory.guardian();
        require(protocolFee <= MAX_PROTOCOL_FEE, "Protocol fee too high.");

        emit GlobalSettingsUpdated(
            capitalPool,
            protocolFee
        );
    }

    function rewardRatePerShare(uint updatedRewardsAt_, uint finishTime) public view returns (uint) {
        if(totalAssetsStaked == 0 || totalPoolShares == 0) {
            return poolRewardRate;
        }
        return (poolRewardRate * (finishTime - updatedRewardsAt_) * 1e18)/totalRewardShares;
    }


    function _updateEpisodesState() internal {
        if(block.timestamp == updatedRewardsAt) {
            return;
        }
        uint currentEpisode = getCurrentEpisode();
        uint lastUpdatedEpisode = updatedRewardsAt / EPISODE_DURATION;

        uint updatedRewardsAt_ = updatedRewardsAt;
        for (uint i = lastUpdatedEpisode; i < currentEpisode; i++) {
            uint prevEpisodFinishTime = getEpisodeFinishTime(i);

            accRewardRatePerShare += rewardRatePerShare(updatedRewardsAt_, prevEpisodFinishTime);
            updatedRewardsAt_ = prevEpisodFinishTime;
            poolRewardRate -= episodes[i + 1].rewardDecrease;

            // Remove expired episodes from total pool count.
            totalRewardShares -= episodes[i].rewardShares;
            totalPoolShares -= episodes[i].episodeShares;
            totalAssetsStaked -= episodes[i].assetsStaked;
        }
        accRewardRatePerShare += rewardRatePerShare(updatedRewardsAt_, block.timestamp);
        updatedRewardsAt = block.timestamp;
    }

    function _updateProductAllocation(Product storage product) internal  {
        uint lastUpdatedEpisode = product.lastAllocationUpdate / EPISODE_DURATION;
        uint currentEpisode = getCurrentEpisode();
        if(lastUpdatedEpisode == currentEpisode) {
            return;
        }
        // If the last update is more than MAX_ACTIVE_EPISODES, all the coverages are expired.
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


    function earnedPosition(uint positionId) public returns (uint) {
        _updateEpisodesState();
        PoolStake storage position = positions[positionId];
        uint reward = 0;
        reward = (position.rewardShares * (accRewardRatePerShare - position.rewardPerShare)) / 1e18;
        return reward;
    }



    function earnedPositions(uint[] memory positionsIds) public returns (uint reward) {
        for(uint i = 0; i < positionsIds.length; i++) {
            reward += earnedPosition(positionsIds[i]);
        }
    }

    function getPoolPosition(uint positionId) external view returns (PoolStake memory position) {
        return positions[positionId];
    }

    function collectRewards(uint[] memory positionsIds) external {
        uint reward = earnedPositions(positionsIds);
        for(uint i = 0; i < positionsIds.length; i++) {
            require(positionNFT.ownerOf(positionsIds[i]) == msg.sender, "Only position owner can collect rewards.");
            positions[positionsIds[i]].rewardPerShare = accRewardRatePerShare;
        }
        if (reward > 0) {
            poolAsset.transfer(msg.sender, reward);
        }
    }

    function setNewDepositsFlag(bool isNewDepositsAccepted_) external {
        require(msg.sender == poolUnderwriter, "Access check fail.");
        isNewDepositsAccepted = isNewDepositsAccepted_;
    }

    function setUnderwriterFee(uint underwriterFee_) external {
        require(msg.sender == poolUnderwriter, "Access check fail.");
        require(underwriterFee_ <= MAX_UNDERWRITER_FEE, "Underwriter fee too high.");
        underwriterFee = underwriterFee_;
    }

    // Underwriter's part of the stake can't be less then 10%
    function maxSharesUserToStake() public view returns(uint) {
        return (underwriterTotalShares * BASIS_POINTS)/minUnderwriterPercentage - totalPoolShares;
    }

    // Underwriter's part of the stake can't be less then 10%
    function maxUnderwriterSharesToUnstake() public view returns(uint) {
        return underwriterTotalShares - (totalPoolShares * minUnderwriterPercentage)/BASIS_POINTS;
    }

    function joinPool(
        uint amount,
        uint episodeToStake
    ) external whenNotPaused returns (bool completed) {
        require(amount >= minimumStakeAmount, "Too small staking amount.");
        require(msg.sender == poolUnderwriter || isNewDepositsAccepted, "New deposits are not allowed.");

        uint currentEpisode = getCurrentEpisode();
        require(episodeToStake < currentEpisode + MAX_ACTIVE_EPISODES, "Too long staking time.");
        require(episodeToStake >= currentEpisode, "Outdated episode to stake.");
        require((episodeToStake - currentEpisode) % 3 == 2, "Staking episode must be a multiple of 3.");

        _updateEpisodesState();

        uint newPositionId = positionNFT.mintPositionNFT(msg.sender, uint64(poolId));
        uint newShares = totalPoolShares == 0 ? amount : (amount * totalPoolShares) / totalAssetsStaked;
        uint newRewardShares = newShares + newShares * (episodeToStake - currentEpisode - 2) * bonusPerEpisodeStaked / BASIS_POINTS;
        require(msg.sender == poolUnderwriter || newShares <= maxSharesUserToStake(), "Underwriter position can't be less than allowed.");

        Episode storage targetEpisode = episodes[episodeToStake];
        targetEpisode.assetsStaked += amount;
        targetEpisode.episodeShares += newShares;
        targetEpisode.rewardShares += newRewardShares;

        // Save position
        positions[newPositionId] = PoolStake({
            episode: episodeToStake,
            shares: newShares,
            rewardShares: newRewardShares,
            rewardPerShare: accRewardRatePerShare,
            active: true
        });

        if(msg.sender == poolUnderwriter) {
            underwriterTotalShares += newShares;
        }
        totalPoolShares += newShares;
        totalAssetsStaked += amount;
        totalRewardShares += newRewardShares;

        poolAsset.transferFrom(msg.sender, address(this), amount);

        emit PoolJoined(
            episodeToStake,
            msg.sender,
            newPositionId,
            amount,
            newShares,
            totalPoolShares,
            totalAssetsStaked
        );

        return true;
    }

    function extendPoolPosition(uint positionId, uint episodeToStake, uint sharesToWithdraw) external whenNotPaused returns (bool) {
        require(msg.sender == positionNFT.ownerOf(positionId), "Only position owner can extend.");
        require(msg.sender == poolUnderwriter || isNewDepositsAccepted, "Extended deposits are not allowed.");

        uint currentEpisode = getCurrentEpisode();
        require(episodeToStake < currentEpisode + MAX_ACTIVE_EPISODES, "Too long staking time.");
        require(episodeToStake >= currentEpisode, "Outdated episode to stake.");
        require((episodeToStake - currentEpisode) % 3 == 2, "Staking episode must be a multiple of 3.");

        _updateEpisodesState();

        PoolStake storage position = positions[positionId];
        require(msg.sender == poolUnderwriter || position.shares - sharesToWithdraw <= maxSharesUserToStake(), "Underwriter position can't be less than allowed.");
        require(position.episode < currentEpisode || sharesToWithdraw == 0, "It is possible to withdraw on extend only for the expired positions.");

        uint fromEpisode = position.episode; // Capture original episode for event
        uint withdrawAmount = 0;
        if(position.episode < currentEpisode) {
            // Calculate reward and also update the position reward per share
            withdrawAmount += earnedPosition(positionId);
            positions[positionId].rewardPerShare = accRewardRatePerShare;
        }


        // Clean previus episode
        Episode storage previuslyDepositedEpisode = episodes[position.episode];
        uint movedShares = position.shares - sharesToWithdraw;
        uint movedAssets = (movedShares * previuslyDepositedEpisode.assetsStaked) / previuslyDepositedEpisode.episodeShares;
        withdrawAmount += (sharesToWithdraw * previuslyDepositedEpisode.assetsStaked) / previuslyDepositedEpisode.episodeShares;
        previuslyDepositedEpisode.assetsStaked -= movedAssets;
        previuslyDepositedEpisode.episodeShares -= position.shares;
        previuslyDepositedEpisode.rewardShares -= position.rewardShares;

        // Update new target episode
        Episode storage targetEpisode = episodes[episodeToStake];
        targetEpisode.assetsStaked += movedAssets;
        targetEpisode.episodeShares += movedShares;
        targetEpisode.rewardShares += position.rewardShares;
        position.shares -= sharesToWithdraw;

        if(msg.sender == poolUnderwriter) {
            underwriterTotalShares -= sharesToWithdraw;
        }

        // Only for the expired positions
        if(position.episode < currentEpisode) {
            totalPoolShares += movedShares;
            totalAssetsStaked += movedAssets;
            totalRewardShares += position.rewardShares;
        }

        position.episode = episodeToStake;

        if(withdrawAmount > 0) {
            poolAsset.transfer(msg.sender, withdrawAmount);
        }

        emit PoolPositionExtended(
            msg.sender,
            positionId,
            fromEpisode,
            episodeToStake,
            sharesToWithdraw,
            withdrawAmount,
            totalPoolShares,
            totalAssetsStaked
        );

        return true;
    }

    function quitPoolPosition(uint positionId) external whenNotPaused returns (bool completed) {
        address toRemove = msg.sender;
        uint currentEpisode = getCurrentEpisode();
        PoolStake memory position = positions[positionId];
        require(toRemove == positionNFT.ownerOf(positionId), "Only position owner can extend.");
        require(position.active, "Position inactive.");
        require(position.episode < currentEpisode, "Funds are timelocked.");
        _updateEpisodesState();

        require(toRemove != poolUnderwriter ||
            position.shares <= maxUnderwriterSharesToUnstake(),
            "Underwriter position can't be less than allowed."
         );


        uint rewards = earnedPosition(positionId);
        positions[positionId].rewardPerShare = accRewardRatePerShare;
        // First calculate withdraw based on shares in the episode
        Episode storage ep = episodes[position.episode];
        uint withdrawAmount = (position.shares * ep.assetsStaked)/ ep.episodeShares;

        // Clean episode
        ep.assetsStaked -= withdrawAmount;
        ep.episodeShares -= position.shares;
        ep.rewardShares -= position.rewardShares;

        if(toRemove == poolUnderwriter) {
            underwriterTotalShares -= position.shares;
        }
        positions[positionId].active = false;


        withdrawAmount += rewards;

        emit PoolQuitted(
            toRemove,
            positionId,
            withdrawAmount,
            position.shares,
            totalPoolShares,
            totalAssetsStaked
        );

        poolAsset.transfer(msg.sender, withdrawAmount);
        return true;
    }


    function executeClaim(
        address receiver,
        uint amount
    ) external whenNotPaused returns (bool completed) {
        // TODO: Add product based claim fee
        require(msg.sender == claimer, "Caller is not the claimer");
        _updateEpisodesState();
        uint currentEpisode = getCurrentEpisode();

        for(uint i = currentEpisode; i < currentEpisode + MAX_ACTIVE_EPISODES; i++) {
            Episode storage ep = episodes[i];
            ep.assetsStaked -= (amount * ep.assetsStaked) / totalAssetsStaked;
        }
        totalAssetsStaked -= amount;
        poolAsset.transfer(receiver, amount);

        emit ClaimExecuted(
            msg.sender,
            receiver,
            amount,
            totalAssetsStaked
        );
        return true;
    }

    function _rewardPool(uint amount) internal {
        uint currentEpisode = getCurrentEpisode();
        uint currentEpisodeFinishTime = getEpisodeFinishTime(currentEpisode);

        // 1 year + leftover
        uint rewardDuration = EPISODE_DURATION * 12 + (currentEpisodeFinishTime - block.timestamp);
        uint rewardRateIncrease = amount / rewardDuration;
        poolRewardRate += rewardRateIncrease;

        Episode storage ep = episodes[currentEpisode + 13];
        ep.rewardDecrease += rewardRateIncrease;
    }

    function _verifyProductAllocation(uint startEpisode, uint requestedAllocation) internal view returns(bool) {
        uint availableAllocation = 0;
        uint currentEpisode = getCurrentEpisode();
        for(uint i = startEpisode; i < currentEpisode + MAX_ACTIVE_EPISODES; i++) {
            Episode storage ep = episodes[i];
            availableAllocation += ep.assetsStaked;
            if(availableAllocation >= requestedAllocation) {
                return true;
            }
        }
        return true;
    }

    function purchaseCover(
        uint64 productId,
        address coveredAccount,
        uint coverageDuration,
        uint coverageAmount
    ) external whenNotPaused returns (bool completed) {
        Product storage product = products[productId];
        require(product.active, "Product is not active.");
        require(coverageDuration <= product.maxCoverageDuration, "Coverage duration is too long.");
        require(coverageDuration >= 28 days, "Coverage duration is too short.");
        require(coveredAccount != address(0), "Wrong address covered.");

        _updateEpisodesState();
        _updateProductAllocation(product);

        // Check enough allocation
        uint lastCoveredEpisode = (block.timestamp + coverageDuration) / EPISODE_DURATION;
        uint requiredProductAllocation = ((coverageAmount + product.allocation) * BASIS_POINTS)/ product.maxPoolAllocationPercent;
        require(_verifyProductAllocation(lastCoveredEpisode, requiredProductAllocation), "Not enough assets to cover.");
        episodeAllocationCut[productId][lastCoveredEpisode] += coverageAmount;
        product.allocation += coverageAmount;

        // Calculate premium
        uint premiumAmount = (coverageDuration * product.annualPercent * coverageAmount) / (365 days * BASIS_POINTS);
        uint protocolFeeAmount = premiumAmount * protocolFee / BASIS_POINTS;
        uint underwriterFeeAmount = premiumAmount * underwriterFee / BASIS_POINTS;
        poolAsset.transferFrom(msg.sender, address(this), premiumAmount);
        poolAsset.transfer(capitalPool, protocolFeeAmount);
        poolAsset.transfer(poolUnderwriter, underwriterFeeAmount);

        _rewardPool(premiumAmount - protocolFeeAmount - underwriterFeeAmount);

        coverNFT.mintCoverNFT(
            msg.sender,
            coveredAccount,
            coverageAmount,
            productId,
            uint64(block.timestamp),
            uint64(block.timestamp + coverageDuration),
            uint64(poolId)
        );

        emit NewCover(
            msg.sender,
            coveredAccount,
            coverageAmount,
            premiumAmount,
            block.timestamp,
            block.timestamp + coverageDuration
        );
        return true;
    }

    function createProduct(
        string calldata name,
        uint64 annualPercent,
        uint64 maxCoverageDuration,
        uint64 maxPoolAllocationPercent
    ) external returns (uint) {
        require(msg.sender == poolUnderwriter, "Access check fail.");
        require(maxCoverageDuration < (MAX_ACTIVE_EPISODES -1) * EPISODE_DURATION, "Max coverage duration is too long.");
        require(maxPoolAllocationPercent <= BASIS_POINTS, "Max pool allocation is too high.");
        require(annualPercent > 0, "Annual premium must be greater than 0.");

        uint64 productId = productCounter++;
        products[productId] = Product({
            name: name,
            productId: productId,
            annualPercent: annualPercent,
            maxCoverageDuration: maxCoverageDuration,
            maxPoolAllocationPercent: maxPoolAllocationPercent,
            allocation: 0,
            lastAllocationUpdate: block.timestamp,
            active: true
        });
        return productId;
    }

    function setProduct(
        uint productId,
        uint64 annualPercent,
        uint64 maxCoverageDuration,
        uint64 maxPoolAllocationPercent,
        bool active
    ) external {
        // TODO: make multipal products update for txs optimization.
        require(msg.sender == poolUnderwriter, "Access check fail.");
        require(maxCoverageDuration < (MAX_ACTIVE_EPISODES -1) * EPISODE_DURATION, "Max coverage duration is too long.");
        require(maxPoolAllocationPercent <= BASIS_POINTS, "Max pool allocation is too high.");
        require(annualPercent > 0, "Annual premium must be greater than 0.");
        require(productId < productCounter, "Product ID is too high.");

        Product storage product = products[productId];
        product.annualPercent = annualPercent;
        product.maxCoverageDuration = maxCoverageDuration;
        product.maxPoolAllocationPercent = maxPoolAllocationPercent;
        product.active = active;
    }

    function getCurrentEpisode() public view returns (uint) {
        return (block.timestamp) / EPISODE_DURATION;
    }

    function getEpisodeStartTime(uint episodeId) public pure returns (uint) {
        return episodeId * EPISODE_DURATION;
    }

    function getEpisodeFinishTime(uint episodeId) public pure returns (uint) {
        return (episodeId + 1) * EPISODE_DURATION;
    }
}
