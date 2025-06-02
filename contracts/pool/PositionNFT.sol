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
import "../interfaces/IPositionUriDescriptor.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IInsurancePool.sol";

contract PositionNFT is
    Initializable,
    ContextUpgradeable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ERC721EnumerableUpgradeable
{
    using Strings for uint256;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    mapping(uint => uint) public positionPool;
    uint256 public positionIdCounter;

    IPoolFactory public poolFactory;

    IPositionUriDescriptor public uriDescriptor;

    event UriDescriptorUpdated(
        address indexed oldDescriptor,
        address indexed newDescriptor
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _poolFactory,
        address owner,
        address manager,
        address _uriDescriptor
    ) public initializer {
        __Context_init();
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __ERC721_init("Position NFT", "POSITIONNFT");
        __ERC721Enumerable_init();

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(MANAGER_ROLE, manager);
        _setRoleAdmin(MINTER_ROLE, MANAGER_ROLE);
        _setRoleAdmin(MANAGER_ROLE, DEFAULT_ADMIN_ROLE);

        positionIdCounter = 1;
        poolFactory = IPoolFactory(_poolFactory);

        uriDescriptor = IPositionUriDescriptor(_uriDescriptor);
        emit UriDescriptorUpdated(address(0), _uriDescriptor);
    }

    /**
     * @dev Mint a position NFT - can only be called by authorized minters (insurance pools)
     * @param to The address to mint the NFT to
     * @param poolId The pool ID that issued this position
     */
    function mintPositionNFT(
        address to,
        uint64 poolId
    ) external onlyRole(MINTER_ROLE) returns (uint) {
        uint256 positionId = positionIdCounter;
        positionIdCounter++;

        positionPool[positionId] = poolId;

        _mint(to, positionId);

        return positionId;
    }

    /**
     * @dev Burn a position NFT - can only be called by the NFT holder
     * @param positionId The ID of the position NFT to burn
     * @return True if successful
     */
    function burnPositionNFT(
        uint256 positionId
    ) external onlyRole(MINTER_ROLE) returns (bool) {
        delete positionPool[positionId];
        _burn(positionId);
        return true;
    }

    /**
     * @dev Returns the Uniform Resource Identifier (URI) for `tokenId` token.
     * @param tokenId The ID of the token to get the URI for
     * @return The URI for the given token ID
     */
    function tokenURI(
        uint256 tokenId
    ) public view virtual override returns (string memory) {
        uint poolId = positionPool[tokenId];

        return uriDescriptor.tokenURI(tokenId, poolId);
    }

    /**
     * @dev Sets the URI descriptor contract
     * @param _uriDescriptor The address of the new URI descriptor contract
     */
    function setUriDescriptor(
        address _uriDescriptor
    ) external onlyRole(MANAGER_ROLE) {
        address oldDescriptor = address(uriDescriptor);
        uriDescriptor = IPositionUriDescriptor(_uriDescriptor);
        emit UriDescriptorUpdated(oldDescriptor, _uriDescriptor);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @dev Returns true if this contract implements the interface defined by `interfaceId`.
    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        virtual
        override(ERC721EnumerableUpgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return
            ERC721EnumerableUpgradeable.supportsInterface(interfaceId) ||
            AccessControlUpgradeable.supportsInterface(interfaceId);
    }

    function _getPoolUnderwriter(
        uint256 positionId
    ) internal view returns (address) {
        return
            IInsurancePool(poolFactory.pools(positionPool[positionId]))
                .poolUnderwriter();
    }

    /**
     * @dev Override transferFrom to prevent transfers to and from pool underwriter
     * Allows normal transfers between other addresses
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public virtual override(ERC721Upgradeable, IERC721) {
        address underwriter = _getPoolUnderwriter(tokenId);
        require(
            from != underwriter && to != underwriter,
            "PositionNFT: Can't transfer to and from pool underwriter."
        );
        super.transferFrom(from, to, tokenId);
    }

    /**
     * @dev Override safeTransferFrom to prevent transfers to and from pool underwriter
     * Allows normal transfers between other addresses
     */
    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public virtual override(ERC721Upgradeable, IERC721) {
        address underwriter = _getPoolUnderwriter(tokenId);
        require(
            from != underwriter && to != underwriter,
            "PositionNFT: Can't transfer to and from pool underwriter."
        );
        super.safeTransferFrom(from, to, tokenId, data);
    }
}
