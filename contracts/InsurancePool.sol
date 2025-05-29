// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IPoolFactory} from "./IPoolFactory.sol";

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
    uint coveredAmount,
    uint premiumAmount,
    uint startDate,
    uint endDate
);

struct PoolStake {
    uint episode;
    uint shares;
    bool active;
}

struct Episode {
    uint amountCovered;
    uint episodeShares;
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

struct Cover {
    address coveredAccount;
    uint coveredAmount;
    uint64 productId;
    uint64 startDate;
    uint64 endDate;
}


contract InsurancePool is OwnableUpgradeable {
    uint public poolId;

    address public claimer;
    IERC20 public poolAsset;

    uint public totalAssetsStaked;
    uint public totalPoolShares;
    uint public poolRewardRate;


    // Products tracking
    uint64 public productCounter;
    mapping(uint => Product) public products;
    mapping(uint => mapping(uint => uint)) public episodeAllocationCut; // productId => episode => allocationCut

    // User position track mappings
    mapping(address => mapping(uint => uint)) public positionRewardPerShare; // position in episode
    mapping(address => mapping(uint => PoolStake)) public positions;
    mapping(address => uint) public positionCounter;

    // User position shares per episode: episodeId => user => positionId => shares
    mapping(uint => mapping(address => mapping(uint => uint))) public userPositionsShares;

    // Underwriters
    uint public minUnderwriterPercentage;
    address public poolUnderwriter;
    bool public isNewDepositsAccepted;
    uint public underwriterTotalShares;

    uint public minimumStakeAmount;

    // Episodes functions
    uint public episodeDuration;
    mapping(uint => Episode) public episodes;
    uint256 public constant MAX_ACTIVE_EPISODES = 24;


    uint public updatedRewardsAt;
    uint public accRewardRatePerShare;

    // Coverage tracking
    uint64 public coverCounter;
    mapping(uint => Cover) public covers;

    /**
     * @dev Storage gap to allow for future upgrades
     * This reserves storage slots for future variables
     */
    uint256[50] private __gap;

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
        poolId = IPoolFactory(msg.sender).poolCount();

        poolUnderwriter =_poolUnderwritter;
        claimer = _claimer;
        poolAsset = IERC20(_poolAsset);
        totalAssetsStaked = 0;
        totalPoolShares = 0;
        isNewDepositsAccepted = _isNewDepositsAccepted;

        episodeDuration = 91 days/3;
        updatedRewardsAt = block.timestamp;
        minUnderwriterPercentage = _minUnderwriterPercentage;
        // TODO choose correct values
        minimumStakeAmount = 100000000;
    }

    function updateClaimer(address newClaimer) onlyOwner external {
        require(newClaimer != address(0), "New claimer cannot be zero address");
        claimer = newClaimer;
    }

    modifier onlyClaimer() {
        require(msg.sender == claimer, "Caller is not the claimer");
        _;
    }

    function rewardRatePerShare(uint _updatedRewardsAt, uint finishTime) public view returns (uint) {
        if(totalAssetsStaked == 0 || totalPoolShares == 0) {
            return poolRewardRate;
        }
        return (poolRewardRate * (finishTime - _updatedRewardsAt) * 1e18)/totalPoolShares;
    }


    function _updateEpisodesState() internal {
        if(block.timestamp == updatedRewardsAt) {
            return;
        }
        uint currentEpisode = getCurrentEpisode();
        uint lastUpdatedEpisode = updatedRewardsAt / episodeDuration;

        uint _updatedRewardsAt = updatedRewardsAt;
        for (uint i = lastUpdatedEpisode; i < currentEpisode; i++) {
            uint prevEpisodFinishTime = getEpisodeFinishTime(i);

            accRewardRatePerShare += rewardRatePerShare(_updatedRewardsAt, prevEpisodFinishTime);
            _updatedRewardsAt = prevEpisodFinishTime;
            poolRewardRate -= episodes[i + 1].rewardDecrease;

            // Remove expired episodes from total pool count.
            totalPoolShares -= episodes[i].episodeShares;
            totalAssetsStaked -= episodes[i].assetsStaked;
        }
        accRewardRatePerShare += rewardRatePerShare(_updatedRewardsAt, block.timestamp);
        updatedRewardsAt = block.timestamp;
    }

    function _updateProductAllocation(Product storage product) internal  {
        uint lastUpdatedEpisode = product.lastAllocationUpdate / episodeDuration;
        uint currentEpisode = getCurrentEpisode();
        if(lastUpdatedEpisode == currentEpisode) {
            return;
        }
        uint allocationCut = 0;
        for(uint i = lastUpdatedEpisode; i <= currentEpisode; i++) {
            allocationCut += episodeAllocationCut[product.productId][i];
        }
        product.allocation -= allocationCut;
        product.lastAllocationUpdate = block.timestamp;
    }


    function earnedPosition(address _account, uint _positionId) public returns (uint) {
        _updateEpisodesState();
        PoolStake memory position = positions[_account][_positionId];
        uint reward = 0;
        reward = (position.shares * (accRewardRatePerShare - positionRewardPerShare[_account][_positionId])) / 1e18;
        positionRewardPerShare[_account][_positionId] = accRewardRatePerShare;
        return reward;
    }



    function earnedPositions(address _account, uint[] memory _positionsIds) public returns (uint reward) {
        for(uint i = 0; i < _positionsIds.length; i++) {
            reward += earnedPosition(_account, _positionsIds[i]);
        }
    }

    function getPoolPosition(address account, uint positionId) external view returns (PoolStake memory position) {
        return positions[account][positionId];
    }

    function getReward(uint[] memory _positionsIds) external {
        _updateEpisodesState();
        uint reward = earnedPositions(msg.sender, _positionsIds);
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
        return ((((underwriterTotalShares * 10000)/minUnderwriterPercentage) - totalPoolShares) * totalAssetsStaked) / totalPoolShares;
    }

    // Underwriter's part of the stake can't be less then 10%
    function maxUnderwriterToUnstake() public view returns(uint) {
        if(underwriterTotalShares == totalPoolShares) {
            return totalAssetsStaked;
        }
        //TODO make normal fix
        if (totalPoolShares ==0) {
            return underwriterTotalShares;
        }
        return ((underwriterTotalShares - (totalPoolShares * minUnderwriterPercentage) / 10000) * totalAssetsStaked)/totalPoolShares;
    }

    function joinPool(
        uint _amount,
        uint _episodeToStake
    ) external returns (bool completed) {
        require(_amount >= minimumStakeAmount, "Too small staking amount.");
        require(msg.sender == poolUnderwriter || _amount <= maxAmountUserToStake(), "Underwriter position can't be less than allowed.");
        require(msg.sender == poolUnderwriter || isNewDepositsAccepted, "New deposits are not allowed.");

        uint currentEpisode = getCurrentEpisode();
        require(_episodeToStake <= currentEpisode + MAX_ACTIVE_EPISODES - 1, "Too long staking time.");
        require(_episodeToStake > 0, "Too short staking time.");
        require((_episodeToStake - currentEpisode) % 3 == 2, "Staking time must be a multiple of 3.");

        poolAsset.transferFrom(msg.sender, address(this), _amount);
        _updateEpisodesState();


        uint newPositionId = positionCounter[msg.sender]++;
        uint newShares = totalPoolShares == 0 ? _amount : (_amount * totalPoolShares) / totalAssetsStaked;
        Episode storage lastEpisode = episodes[_episodeToStake];
        lastEpisode.assetsStaked += _amount;
        lastEpisode.episodeShares += newShares;
        // Store only once for the withdraw episode.
        userPositionsShares[_episodeToStake][msg.sender][newPositionId] = newShares;

        // Set reward rate for the current episode.
        positionRewardPerShare[msg.sender][newPositionId] = accRewardRatePerShare;

        positions[msg.sender][newPositionId] = PoolStake({
            episode: _episodeToStake,
            shares: newShares,
            active: true
        });

        if(msg.sender == poolUnderwriter) {
            underwriterTotalShares += newShares;
        }
        totalPoolShares += newShares;
        totalAssetsStaked += _amount;

        emit PoolJoined(
            currentEpisode,
            _episodeToStake,
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
        address toRemove = msg.sender;
        uint currentEpisode = getCurrentEpisode();
        PoolStake memory position = positions[toRemove][positionId];
        require(position.active, "Position inactive.");
        require(position.episode < currentEpisode, "Funds are timelocked.");
        _updateEpisodesState();


        uint rewards = earnedPosition(toRemove, positionId);
        // First calculate withdraw based on shares in the episode
        Episode storage ep = episodes[position.episode];
        uint withdrawAmount = (userPositionsShares[position.episode][toRemove][positionId]*ep.assetsStaked)/ ep.episodeShares;
        require(toRemove != poolUnderwriter || withdrawAmount <= maxUnderwriterToUnstake(), "Underwriter position can't be less than allowed.");

        // New removals - only subtract the original stake amount, not the rewards
        ep.assetsStaked -= withdrawAmount;
        ep.episodeShares -= userPositionsShares[position.episode][toRemove][positionId];
        userPositionsShares[position.episode][toRemove][positionId] = 0;

        if(toRemove == poolUnderwriter) {
            underwriterTotalShares -= position.shares;
        }
        positions[toRemove][positionId].active = false;


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
    ) external onlyClaimer returns (bool completed) {
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
            totalAssetsStaked,
            block.timestamp
        );
        return true;
    }

    function _rewardPool(uint amount) internal {
        uint currentEpisode = getCurrentEpisode();
        uint currentEpisodeFinishTime = getEpisodeFinishTime(currentEpisode);

        Episode storage ep = episodes[currentEpisode];

        // 1 year + leftover
        uint rewardDuration = episodeDuration * 12 + (currentEpisodeFinishTime - block.timestamp);
        uint rewardRateIncrease = amount / rewardDuration;
        poolRewardRate += rewardRateIncrease;

        ep = episodes[currentEpisode + 13];
        ep.rewardDecrease += rewardRateIncrease;
    }

    function _verifyProductAllocation(uint lastCoveredEpisode, uint requestedAllocation) internal view returns(bool) {
        uint availableAllocation = 0;
        uint currentEpisode = getCurrentEpisode();
        for(uint i = lastCoveredEpisode; i < currentEpisode + MAX_ACTIVE_EPISODES; i++) {
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
    ) external returns (bool completed) {
        Product storage product = products[productId];
        require(product.active, "Product is not active.");
        require(coverageDuration <= product.maxCoverageDuration, "Coverage duration is too long.");
        require(coverageDuration >= 28 days, "Coverage duration is too short.");
        require(coveredAccount != address(0), "Wrong address covered.");

        _updateEpisodesState();
        _updateProductAllocation(product);

        // Check enought allocation
        uint lastCoveredEpisode = (block.timestamp + coverageDuration) / episodeDuration;
        uint requiredProductAllocation = ((coverageAmount + product.allocation) * 10000)/ product.maxPoolAllocationPercent;
        require(_verifyProductAllocation(lastCoveredEpisode, requiredProductAllocation), "Not enough assets to cover.");
        episodeAllocationCut[productId][lastCoveredEpisode] += coverageAmount;
        product.allocation += coverageAmount;

        // Calculate premium
        uint premiumAmount = (coverageDuration * product.annualPercent * coverageAmount) / (365 days * 10000);
        poolAsset.transferFrom(msg.sender, address(this), premiumAmount);
        _rewardPool(premiumAmount);


        uint64 coverId = coverCounter++;
        covers[coverId] = Cover({
            productId: productId,
            coveredAccount: coveredAccount,
            coveredAmount: coverageAmount,
            startDate: uint64(block.timestamp),
            endDate: uint64(block.timestamp + coverageDuration)
        });

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
        require(maxCoverageDuration < (MAX_ACTIVE_EPISODES -1) * episodeDuration, "Max coverage duration is too long.");
        require(maxPoolAllocationPercent <= 10000, "Max pool allocation is too high.");
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
        require(msg.sender == poolUnderwriter, "Access check fail.");
        require(maxCoverageDuration < (MAX_ACTIVE_EPISODES -1) * episodeDuration, "Max coverage duration is too long.");
        require(maxPoolAllocationPercent <= 10000, "Max pool allocation is too high.");
        require(annualPercent > 0, "Annual premium must be greater than 0.");
        require(productId < productCounter, "Product ID is too high.");

        Product storage product = products[productId];
        product.annualPercent = annualPercent;
        product.maxCoverageDuration = maxCoverageDuration;
        product.maxPoolAllocationPercent = maxPoolAllocationPercent;
        product.active = active;
    }

    function getCurrentEpisode() public view returns (uint) {
        return (block.timestamp) / episodeDuration;
    }

    function getEpisodeStartTime(uint episodeId) public view returns (uint) {
        return episodeId * episodeDuration;
    }

    function getEpisodeFinishTime(uint episodeId) public view returns (uint) {
        return (episodeId + 1) * episodeDuration;
    }
}
