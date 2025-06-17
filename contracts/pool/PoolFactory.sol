// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlEnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
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
    AccessControlEnumerableUpgradeable
{
    // Constants
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // State variables
    address public settings;
    uint256 public poolCount;
    mapping(uint256 => address) public pools;

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
        IProtocolSettings protocolSettings = IProtocolSettings(settings);
        address beacon = protocolSettings.beacon();
        require(beacon != address(0), "Beacon not set");

        poolId = ++poolCount;
        poolAddress = address(
            new BeaconProxy{salt: bytes32(poolId)}(beacon, poolInitData_)
        );
        pools[poolId] = poolAddress;

        // Grant minter roles to the new pool
        IAccessControl(protocolSettings.coverNFT()).grantRole(MINTER_ROLE, poolAddress);
        IAccessControl(protocolSettings.positionNFT()).grantRole(MINTER_ROLE, poolAddress);

        emit PoolCreated(poolId, poolAddress);
    }
}
