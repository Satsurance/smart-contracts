// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "../interfaces/IUriDescriptor.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IInsurancePool.sol";

/**
 * @title PositionNFT
 * @notice NFT contract for representing insurance pool positions
 * @dev Implements ERC721 with enumerable extension and access control
 */
contract PositionNFT is
    Initializable,
    ContextUpgradeable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ERC721EnumerableUpgradeable
{
    using Strings for uint256;

    // Custom errors for gas efficiency
    error InvalidAddress();
    error UnauthorizedTransfer();
    error InvalidPoolId();
    error PositionDoesNotExist();

    // Role definitions
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // State variables
    mapping(uint => uint) public positionPool;
    uint256 public positionIdCounter;
    IPoolFactory public poolFactory;
    IUriDescriptor public uriDescriptor;

    // Events
    event PositionMinted(
        uint256 indexed positionId,
        address indexed recipient,
        uint64 indexed poolId
    );

    event PositionBurned(uint256 indexed positionId, uint64 indexed poolId);

    event UriDescriptorUpdated(
        address indexed oldDescriptor,
        address indexed newDescriptor
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract
     * @param poolFactory_ Address of the pool factory contract
     * @param owner_ Address of the contract owner
     * @param manager_ Address of the contract manager
     * @param uriDescriptor_ Address of the URI descriptor contract
     */
    function initialize(
        address poolFactory_,
        address owner_,
        address manager_,
        address uriDescriptor_
    ) public initializer {
        if (
            poolFactory_ == address(0) ||
            owner_ == address(0) ||
            manager_ == address(0) ||
            uriDescriptor_ == address(0)
        ) {
            revert InvalidAddress();
        }

        __Context_init();
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __ERC721_init("Insurance Position NFT", "iPOSITION");
        __ERC721Enumerable_init();

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(MANAGER_ROLE, manager_);
        _setRoleAdmin(MINTER_ROLE, MANAGER_ROLE);
        _setRoleAdmin(MANAGER_ROLE, DEFAULT_ADMIN_ROLE);

        positionIdCounter = 1;
        poolFactory = IPoolFactory(poolFactory_);
        uriDescriptor = IUriDescriptor(uriDescriptor_);

        emit UriDescriptorUpdated(address(0), uriDescriptor_);
    }

    /**
     * @notice Mints a new position NFT
     * @dev Can only be called by authorized minters (insurance pools)
     * @param to_ Address to mint the NFT to
     * @param poolId_ ID of the pool that issued this position
     * @return positionId The ID of the newly minted position
     */
    function mintPositionNFT(
        address to_,
        uint64 poolId_
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        if (to_ == address(0)) revert InvalidAddress();
        if (poolId_ == 0) revert InvalidPoolId();

        uint256 positionId = positionIdCounter;
        positionIdCounter++;

        positionPool[positionId] = poolId_;

        _mint(to_, positionId);

        emit PositionMinted(positionId, to_, poolId_);

        return positionId;
    }

    /**
     * @notice Burns a position NFT
     * @dev Can only be called by authorized minters (insurance pools)
     * @param positionId_ ID of the position NFT to burn
     * @return success True if successful
     */
    function burnPositionNFT(
        uint256 positionId_
    ) external onlyRole(MINTER_ROLE) returns (bool) {
        uint64 poolId = uint64(positionPool[positionId_]);
        delete positionPool[positionId_];
        _burn(positionId_);

        emit PositionBurned(positionId_, poolId);

        return true;
    }

    /**
     * @notice Returns the metadata URI for a token
     * @param tokenId_ ID of the token to get the URI for
     * @return uri The metadata URI for the given token ID
     */
    function tokenURI(
        uint256 tokenId_
    ) public view virtual override returns (string memory) {
        uint256 poolId = positionPool[tokenId_];
        bytes memory metadata = abi.encode(poolId);
        return uriDescriptor.tokenURI(tokenId_, metadata);
    }

    /**
     * @notice Updates the URI descriptor contract
     * @param uriDescriptor_ Address of the new URI descriptor contract
     */
    function setUriDescriptor(
        address uriDescriptor_
    ) external onlyRole(MANAGER_ROLE) {
        if (uriDescriptor_ == address(0)) revert InvalidAddress();

        address oldDescriptor = address(uriDescriptor);
        uriDescriptor = IUriDescriptor(uriDescriptor_);

        emit UriDescriptorUpdated(oldDescriptor, uriDescriptor_);
    }

    /**
     * @notice Authorizes contract upgrades
     * @param newImplementation_ Address of the new implementation
     */
    function _authorizeUpgrade(
        address newImplementation_
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /**
     * @notice Checks if contract supports an interface
     * @param interfaceId_ The interface identifier to check
     * @return supported True if the interface is supported
     */
    function supportsInterface(
        bytes4 interfaceId_
    )
        public
        view
        virtual
        override(ERC721EnumerableUpgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return
            ERC721EnumerableUpgradeable.supportsInterface(interfaceId_) ||
            AccessControlUpgradeable.supportsInterface(interfaceId_);
    }

    /**
     * @notice Gets the pool underwriter for a position
     * @param positionId_ ID of the position
     * @return underwriter Address of the pool underwriter
     */
    function _getPoolUnderwriter(
        uint256 positionId_
    ) internal view returns (address) {
        return
            IInsurancePool(poolFactory.pools(positionPool[positionId_]))
                .poolUnderwriter();
    }

    /**
     * @notice Validates transfer restrictions
     * @param from_ Source address
     * @param to_ Destination address
     * @param tokenId_ Token being transferred
     */
    modifier validateTransfer(
        address from_,
        address to_,
        uint256 tokenId_
    ) {
        address underwriter = _getPoolUnderwriter(tokenId_);
        if (from_ == underwriter || to_ == underwriter) {
            revert UnauthorizedTransfer();
        }
        _;
    }

    /**
     * @notice Transfers a position NFT with underwriter restrictions
     * @param from_ Source address
     * @param to_ Destination address
     * @param tokenId_ ID of the token to transfer
     */
    function transferFrom(
        address from_,
        address to_,
        uint256 tokenId_
    )
        public
        virtual
        override(ERC721Upgradeable, IERC721)
        validateTransfer(from_, to_, tokenId_)
    {
        super.transferFrom(from_, to_, tokenId_);
    }

    /**
     * @notice Safely transfers a position NFT with underwriter restrictions
     * @param from_ Source address
     * @param to_ Destination address
     * @param tokenId_ ID of the token to transfer
     * @param data_ Additional data with no specified format
     */
    function safeTransferFrom(
        address from_,
        address to_,
        uint256 tokenId_,
        bytes memory data_
    )
        public
        virtual
        override(ERC721Upgradeable, IERC721)
        validateTransfer(from_, to_, tokenId_)
    {
        super.safeTransferFrom(from_, to_, tokenId_, data_);
    }
}
