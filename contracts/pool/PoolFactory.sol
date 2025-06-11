// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlEnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import "../interfaces/IPoolFactory.sol";

/**
 * @title PoolFactory
 * @notice Factory contract for creating and managing insurance pool instances
 * @dev Uses beacon proxy pattern for upgradeable pool implementations
 */
contract PoolFactory is
    IPoolFactory,
    Initializable,
    AccessControlEnumerableUpgradeable
{
    // Constants
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant MAX_PROTOCOL_FEE = 1500; // 15% max fee in basis points

    // State variables
    address public beacon;
    address public protocolRewardsAddress;
    address public capitalPool;
    address public coverNFT;
    address public positionNFT;
    address public guardian;
    uint256 public protocolFee;
    uint256 public poolCount;
    mapping(uint256 => address) public pools;

    modifier notZeroAddress(address addr) {
        require(addr != address(0), "Zero address not allowed");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the factory contract
     * @param owner_ Address to grant DEFAULT_ADMIN_ROLE
     * @param operator_ Address to grant OPERATOR_ROLE
     * @param protocolRewardsAddress_ Address of the protocol rewards
     * @param capitalPool_ Address of the capital pool
     * @param beacon_ Address of the beacon for pool proxies
     * @param coverNFT_ Address of the cover NFT contract
     * @param positionNFT_ Address of the position NFT contract
     * @param guardian_ Address of the guardian
     * @param protocolFee_ Initial protocol fee in basis points
     */
    function initialize(
        address owner_,
        address operator_,
        address protocolRewardsAddress_,
        address capitalPool_,
        address beacon_,
        address coverNFT_,
        address positionNFT_,
        address guardian_,
        uint256 protocolFee_
    ) public initializer {
        __AccessControlEnumerable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(OPERATOR_ROLE, operator_);
        _setRoleAdmin(OPERATOR_ROLE, OPERATOR_ROLE);

        coverNFT = coverNFT_;
        positionNFT = positionNFT_;
        setBeacon(beacon_);
        setProtocolRewardsAddress(protocolRewardsAddress_);
        setCapitalPool(capitalPool_);
        setGuardian(guardian_);
        setProtocolFee(protocolFee_);
    }

    /**
     * @notice Updates the protocol rewards address
     * @param newProtocolRewardsAddress_ New protocol rewards address
     */
    function setProtocolRewardsAddress(
        address newProtocolRewardsAddress_
    )
        public
        onlyRole(OPERATOR_ROLE)
        notZeroAddress(newProtocolRewardsAddress_)
    {
        address previousProtocolRewardsAddress = protocolRewardsAddress;
        protocolRewardsAddress = newProtocolRewardsAddress_;
        emit ProtocolRewardsAddressUpdated(
            previousProtocolRewardsAddress,
            newProtocolRewardsAddress_
        );
    }

    /**
     * @notice Updates the capital pool address
     * @param newCapitalPool_ New capital pool address
     */
    function setCapitalPool(
        address newCapitalPool_
    ) public onlyRole(OPERATOR_ROLE) notZeroAddress(newCapitalPool_) {
        address previousCapitalPool = capitalPool;
        capitalPool = newCapitalPool_;
        emit CapitalPoolUpdated(previousCapitalPool, newCapitalPool_);
    }

    /**
     * @notice Updates the position NFT contract address
     * @param newPositionNFT_ New position NFT address
     */
    function setPositionNFT(
        address newPositionNFT_
    ) public onlyRole(OPERATOR_ROLE) notZeroAddress(newPositionNFT_) {
        address previousPositionNFT = positionNFT;
        positionNFT = newPositionNFT_;
        emit PositionNFTUpdated(previousPositionNFT, newPositionNFT_);
    }

    /**
     * @notice Updates the guardian address
     * @param newGuardian_ New guardian address
     */
    function setGuardian(
        address newGuardian_
    ) public onlyRole(OPERATOR_ROLE) notZeroAddress(newGuardian_) {
        address previousGuardian = guardian;
        guardian = newGuardian_;
        emit GuardianUpdated(previousGuardian, newGuardian_);
    }

    /**
     * @notice Updates the protocol fee
     * @param newProtocolFee_ New protocol fee in basis points
     */
    function setProtocolFee(
        uint256 newProtocolFee_
    ) public onlyRole(OPERATOR_ROLE) {
        require(
            newProtocolFee_ <= MAX_PROTOCOL_FEE,
            "Protocol fee exceeds maximum"
        );
        uint256 previousFee = protocolFee;
        protocolFee = newProtocolFee_;
        emit ProtocolFeeUpdated(previousFee, newProtocolFee_);
    }

    /**
     * @notice Updates the beacon address for pool proxies
     * @param newBeacon_ New beacon address
     */
    function setBeacon(
        address newBeacon_
    ) public onlyRole(DEFAULT_ADMIN_ROLE) notZeroAddress(newBeacon_) {
        address previousBeacon = beacon;
        beacon = newBeacon_;
        emit BeaconUpdated(previousBeacon, newBeacon_);
    }

    /**
     * @notice Creates a new insurance pool
     * @param poolInitData_ Initialization data for the pool
     * @return poolId The ID of the created pool
     * @return poolAddress The address of the created pool
     */
    function create(
        bytes calldata poolInitData_
    ) external returns (uint256 poolId, address poolAddress) {
        require(beacon != address(0), "Beacon not set");

        poolId = ++poolCount;
        poolAddress = address(
            new BeaconProxy{salt: bytes32(poolId)}(beacon, poolInitData_)
        );
        pools[poolId] = poolAddress;

        // Grant minter roles to the new pool
        IAccessControl(coverNFT).grantRole(MINTER_ROLE, poolAddress);
        IAccessControl(positionNFT).grantRole(MINTER_ROLE, poolAddress);

        emit PoolCreated(poolId, poolAddress);
    }
}
