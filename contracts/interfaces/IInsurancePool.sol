// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IInsurancePool {
    // Events
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

    event GlobalSettingsUpdated(address indexed capitalPool, uint protocolFee);

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

    // Structs
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
        uint coverageDecrease;
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

    // Constants
    function MAX_PROTOCOL_FEE() external view returns (uint);

    function MAX_UNDERWRITER_FEE() external view returns (uint);

    function MAX_ACTIVE_EPISODES() external view returns (uint256);

    function EPISODE_DURATION() external view returns (uint);

    function BASIS_POINTS() external view returns (uint);

    // State variables
    function poolId() external view returns (uint);

    function factory() external view returns (address);

    function coverNFT() external view returns (address);

    function positionNFT() external view returns (address);

    function capitalPool() external view returns (address);

    function claimer() external view returns (address);

    function guardian() external view returns (address);

    function poolAsset() external view returns (address);

    function totalAssetsStaked() external view returns (uint);

    function totalPoolShares() external view returns (uint);

    function totalRewardShares() external view returns (uint);

    function poolRewardRate() external view returns (uint);

    function bonusPerEpisodeStaked() external view returns (uint);

    function protocolFee() external view returns (uint);

    function productCounter() external view returns (uint64);

    function minUnderwriterPercentage() external view returns (uint);

    function poolUnderwriter() external view returns (address);

    function isNewDepositsAccepted() external view returns (bool);

    function underwriterTotalShares() external view returns (uint);

    function underwriterFee() external view returns (uint);

    function minimumStakeAmount() external view returns (uint);

    function updatedRewardsAt() external view returns (uint);

    function accRewardRatePerShare() external view returns (uint);

    function totalCoverAllocation() external view returns (uint);

    // Mappings
    function products(
        uint
    )
        external
        view
        returns (
            string memory name,
            uint64 productId,
            uint64 annualPercent,
            uint64 maxCoverageDuration,
            uint64 maxPoolAllocationPercent,
            uint allocation,
            uint lastAllocationUpdate,
            bool active
        );

    function episodeAllocationCut(uint, uint) external view returns (uint);

    function positions(
        uint
    )
        external
        view
        returns (
            uint episode,
            uint shares,
            uint rewardShares,
            uint rewardPerShare,
            bool active
        );

    function episodes(
        uint
    )
        external
        view
        returns (
            uint episodeShares,
            uint rewardShares,
            uint assetsStaked,
            uint rewardDecrease,
            uint coverageDecrease
        );

    // Functions
    function initialize(
        address _poolUnderwritter,
        address _governor,
        address _poolAsset,
        address _claimer,
        uint _minUnderwriterPercentage,
        uint _bonusPerEpisodeStaked,
        bool _isNewDepositsAccepted,
        uint _underwriterFee
    ) external;

    function updateClaimer(address newClaimer) external;

    function pause() external;

    function unpause() external;

    function updateGlobalSettings() external;

    function rewardRatePerShare(
        uint _updatedRewardsAt,
        uint finishTime
    ) external view returns (uint);

    function earnedPosition(uint _positionId) external returns (uint);

    function earnedPositions(
        uint[] memory _positionsIds
    ) external returns (uint reward);

    function getPoolPosition(
        uint positionId
    ) external view returns (PoolStake memory position);

    function collectRewards(uint[] memory _positionsIds) external;

    function setNewDepositsFlag(bool _isNewDepositsAccepted) external;

    function setUnderwriterFee(uint _underwriterFee) external;

    function maxSharesUserToStake() external view returns (uint);

    function maxUnderwriterSharesToUnstake() external view returns (uint);

    function joinPool(
        uint _amount,
        uint _episodeToStake
    ) external returns (bool completed);

    function extendPoolPosition(
        uint _positionId,
        uint _episodeToStake,
        uint _sharesToWithdraw
    ) external returns (bool);

    function quitPoolPosition(
        uint positionId
    ) external returns (bool completed);

    function executeClaim(
        address receiver,
        uint amount
    ) external returns (bool completed);

    function purchaseCover(
        uint64 productId,
        address coveredAccount,
        uint coverageDuration,
        uint coverageAmount
    ) external returns (bool completed);

    function createProduct(
        string calldata name,
        uint64 annualPercent,
        uint64 maxCoverageDuration,
        uint64 maxPoolAllocationPercent
    ) external returns (uint);

    function setProduct(
        uint productId,
        uint64 annualPercent,
        uint64 maxCoverageDuration,
        uint64 maxPoolAllocationPercent,
        bool active
    ) external;

    function getCurrentEpisode() external view returns (uint);

    function getEpisodeStartTime(uint episodeId) external pure returns (uint);

    function getEpisodeFinishTime(uint episodeId) external pure returns (uint);
}
