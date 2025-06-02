// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlEnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import "./IPoolFactory.sol";

contract PoolFactory is
    IPoolFactory,
    Initializable,
    AccessControlEnumerableUpgradeable
{
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    address public beacon;
    address public capitalPool;
    address public coverNFT;
    uint256 public protocolFee;
    uint96 internal _poolCount;
    mapping(uint => address) public pools;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _operator,
        address _capitalPool,
        address _beacon,
        address _coverNFT,
        uint256 _protocolFee
    ) public initializer {
        __AccessControlEnumerable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(OPERATOR_ROLE, _operator);
        _setRoleAdmin(OPERATOR_ROLE, OPERATOR_ROLE);

        coverNFT = _coverNFT;
        setBeacon(_beacon);
        setCapitalPool(_capitalPool);
        setProtocolFee(_protocolFee);
    }

    function setCapitalPool(
        address newCapitalPool
    ) public onlyRole(OPERATOR_ROLE) {
        require(
            newCapitalPool != address(0),
            "PoolFactory: Invalid capital pool"
        );
        capitalPool = newCapitalPool;
    }

    function setProtocolFee(
        uint256 newProtocolFee
    ) public onlyRole(OPERATOR_ROLE) {
        protocolFee = newProtocolFee;
    }

    function setBeacon(address newBeacon) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newBeacon != address(0), "PoolFactory: Invalid beacon");

        address oldBeacon = beacon;
        beacon = newBeacon;

        emit BeaconChanged(oldBeacon, newBeacon);
    }

    function poolCount() external view returns (uint) {
        return _poolCount;
    }

    function create(
        bytes calldata initData
    ) external returns (uint poolId, address poolAddress) {
        require(beacon != address(0), "PoolFactory: Beacon not set");

        poolId = ++_poolCount;
        poolAddress = address(
            new BeaconProxy{salt: bytes32(poolId)}(beacon, initData)
        );
        pools[poolId] = poolAddress;
        IAccessControl(coverNFT).grantRole(MINTER_ROLE, poolAddress);

        emit PoolCreated(poolId, poolAddress);
    }
}
