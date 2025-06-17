// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IProtocolSettings {
    event BeaconUpdated(address indexed previousBeacon, address indexed newBeacon);
    event ProtocolRewardsAddressUpdated(address indexed previousProtocolRewardsAddress, address indexed newProtocolRewardsAddress);
    event CapitalPoolUpdated(address indexed previousCapitalPool, address indexed newCapitalPool);
    event PositionNFTUpdated(address indexed previousPositionNFT, address indexed newPositionNFT);
    event CoverNFTUpdated(address indexed previousCoverNFT, address indexed newCoverNFT);
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    event ProtocolFeeUpdated(uint256 previousFee, uint256 newFee);

    function beacon() external view returns (address);
    function protocolRewardsAddress() external view returns (address);
    function capitalPool() external view returns (address);
    function coverNFT() external view returns (address);
    function positionNFT() external view returns (address);
    function guardian() external view returns (address);
    function protocolFee() external view returns (uint256);

    function setBeacon(address newBeacon) external;
    function setProtocolRewardsAddress(address newProtocolRewardsAddress) external;
    function setCapitalPool(address newCapitalPool) external;
    function setCoverNFT(address newCoverNFT) external;
    function setPositionNFT(address newPositionNFT) external;
    function setGuardian(address newGuardian) external;
    function setProtocolFee(uint256 newProtocolFee) external;
}
