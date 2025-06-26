// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlEnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IProtocolSettings.sol";

/**
 * @title PoolFactory
 * @notice Factory contract for creating and managing insurance pool instances
 * @dev Uses beacon proxy pattern for upgradeable pool implementations
 */
contract PoolFactory is
    IPoolFactory,
    Initializable,
    AccessControlEnumerableUpgradeable,
    EIP712Upgradeable
{
    // Constants
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // EIP-712 type hash
    bytes32 private constant CREATE_POOL_TYPEHASH =
        keccak256(
            "CreatePool(bytes poolInitData,uint256 deadline,uint256 nonce)"
        );

    // State variables
    address public settings;
    uint256 public poolCount;
    mapping(uint256 => address) public pools;

    /**
     * @dev Storage gap to allow for future upgrades
     * This reserves storage slots for future variables
     */
    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the factory contract
     * @param owner_ Address to grant DEFAULT_ADMIN_ROLE
     * @param operator_ Address to grant OPERATOR_ROLE
     * @param settings_ Address of the ProtocolSettings contract
     */
    function initialize(
        address owner_,
        address operator_,
        address settings_
    ) public initializer {
        __AccessControlEnumerable_init();
        __EIP712_init("PoolFactory", "1");

        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(OPERATOR_ROLE, operator_);
        _setRoleAdmin(OPERATOR_ROLE, OPERATOR_ROLE);

        settings = settings_;
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
        require(
            hasRole(OPERATOR_ROLE, msg.sender),
            "Only operator can create pools"
        );

        return _createPool(poolInitData_);
    }

    /**
     * @notice Creates a new insurance pool with operator signature
     * @param poolInitData_ Initialization data for the pool
     * @param deadline_ Deadline for the signature
     * @param nonce_ Nonce for the signature (should be next pool ID)
     * @param signature_ Signature from an operator
     * @return poolId The ID of the created pool
     * @return poolAddress The address of the created pool
     */
    function createWithSignature(
        bytes calldata poolInitData_,
        uint256 deadline_,
        uint256 nonce_,
        bytes calldata signature_
    ) external returns (uint256 poolId, address poolAddress) {
        require(block.timestamp <= deadline_, "Signature expired");
        require(nonce_ == poolCount + 1, "Invalid nonce");

        bytes32 structHash = keccak256(
            abi.encode(
                CREATE_POOL_TYPEHASH,
                keccak256(poolInitData_),
                deadline_,
                nonce_
            )
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, signature_);

        require(hasRole(OPERATOR_ROLE, signer), "Invalid operator signature");

        return _createPool(poolInitData_);
    }

    /**
     * @notice Internal function to create a pool
     * @param poolInitData_ Initialization data for the pool
     * @return poolId The ID of the created pool
     * @return poolAddress The address of the created pool
     */
    function _createPool(
        bytes calldata poolInitData_
    ) internal returns (uint256 poolId, address poolAddress) {
        IProtocolSettings protocolSettings = IProtocolSettings(settings);
        address beacon = protocolSettings.beacon();
        require(beacon != address(0), "Beacon not set");

        poolId = ++poolCount;
        poolAddress = address(
            new BeaconProxy{salt: bytes32(poolId)}(beacon, poolInitData_)
        );
        pools[poolId] = poolAddress;

        // Grant minter roles to the new pool
        IAccessControl(protocolSettings.coverNFT()).grantRole(
            MINTER_ROLE,
            poolAddress
        );
        IAccessControl(protocolSettings.positionNFT()).grantRole(
            MINTER_ROLE,
            poolAddress
        );

        emit PoolCreated(poolId, poolAddress);
    }
}
