// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlEnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import {IProtocolSettings} from "../interfaces/IProtocolSettings.sol";

/**
 * @title ProtocolSettings
 * @notice Stores global configuration used across the protocol
 */
contract ProtocolSettings is
    IProtocolSettings,
    Initializable,
    AccessControlEnumerableUpgradeable
{
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    uint256 public constant MAX_PROTOCOL_FEE = 1500; // 15% max fee in basis points

    address public beacon;
    address public protocolRewardsAddress;
    address public capitalPool;
    address public coverNFT;
    address public positionNFT;
    address public guardian;
    uint256 public protocolFee;

    modifier notZeroAddress(address addr) {
        require(addr != address(0), "Zero address not allowed");
        _;
    }

    constructor() {
        _disableInitializers();
    }

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

    function setBeacon(
        address newBeacon
    ) public onlyRole(DEFAULT_ADMIN_ROLE) notZeroAddress(newBeacon) {
        address previousBeacon = beacon;
        beacon = newBeacon;
        emit BeaconUpdated(previousBeacon, newBeacon);
    }

    function setProtocolRewardsAddress(
        address newProtocolRewardsAddress
    ) public onlyRole(OPERATOR_ROLE) notZeroAddress(newProtocolRewardsAddress) {
        address previousProtocolRewardsAddress = protocolRewardsAddress;
        protocolRewardsAddress = newProtocolRewardsAddress;
        emit ProtocolRewardsAddressUpdated(
            previousProtocolRewardsAddress,
            newProtocolRewardsAddress
        );
    }

    function setCapitalPool(
        address newCapitalPool
    ) public onlyRole(DEFAULT_ADMIN_ROLE) notZeroAddress(newCapitalPool) {
        address previousCapitalPool = capitalPool;
        capitalPool = newCapitalPool;
        emit CapitalPoolUpdated(previousCapitalPool, newCapitalPool);
    }

    function setCoverNFT(
        address newCoverNFT
    ) public onlyRole(DEFAULT_ADMIN_ROLE) notZeroAddress(newCoverNFT) {
        address previousCoverNFT = coverNFT;
        coverNFT = newCoverNFT;
        emit CoverNFTUpdated(previousCoverNFT, newCoverNFT);
    }

    function setPositionNFT(
        address newPositionNFT
    ) public onlyRole(DEFAULT_ADMIN_ROLE) notZeroAddress(newPositionNFT) {
        address previousPositionNFT = positionNFT;
        positionNFT = newPositionNFT;
        emit PositionNFTUpdated(previousPositionNFT, newPositionNFT);
    }

    function setGuardian(
        address newGuardian
    ) public onlyRole(OPERATOR_ROLE) notZeroAddress(newGuardian) {
        address previousGuardian = guardian;
        guardian = newGuardian;
        emit GuardianUpdated(previousGuardian, newGuardian);
    }

    function setProtocolFee(
        uint256 newProtocolFee
    ) public onlyRole(OPERATOR_ROLE) {
        require(
            newProtocolFee <= MAX_PROTOCOL_FEE,
            "Protocol fee exceeds maximum"
        );
        uint256 previousFee = protocolFee;
        protocolFee = newProtocolFee;
        emit ProtocolFeeUpdated(previousFee, newProtocolFee);
    }
}
