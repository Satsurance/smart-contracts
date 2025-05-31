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
import "./IUriDescriptor.sol";
import "./ICoverNFT.sol";

contract CoverNFT is
    Initializable,
    ContextUpgradeable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ERC721EnumerableUpgradeable
{
    using Strings for uint256;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // Mapping from coverId to cover data
    mapping(uint256 => Cover) public covers;

    // Counter for generating unique cover IDs
    uint256 public coverIdCounter;

    // URI descriptor contract for generating token URIs
    IUriDescriptor public uriDescriptor;

    event CoverNFTMinted(
        uint256 indexed coverId,
        address indexed to,
        address indexed pool,
        address coveredAccount,
        uint256 coveredAmount,
        uint64 productId,
        uint64 startDate,
        uint64 endDate
    );

    event CoverNFTBurned(uint256 indexed coverId, uint256 indexed poolId);

    event UriDescriptorUpdated(
        address indexed oldDescriptor,
        address indexed newDescriptor
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner,
        address manager,
        address _uriDescriptor
    ) public initializer {
        __Context_init();
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __ERC721_init("Insurance Cover NFT", "COVERNFT");
        __ERC721Enumerable_init();

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(MANAGER_ROLE, manager);
        _setRoleAdmin(MINTER_ROLE, MANAGER_ROLE);
        _setRoleAdmin(MANAGER_ROLE, DEFAULT_ADMIN_ROLE);

        coverIdCounter = 1; // Start token IDs from 1

        // Set the URI descriptor
        uriDescriptor = IUriDescriptor(_uriDescriptor);
        emit UriDescriptorUpdated(address(0), _uriDescriptor);
    }

    /**
     * @dev Mint a cover NFT - can only be called by authorized minters (insurance pools)
     * @param to The address to mint the NFT to
     * @param coveredAccount The account that is covered
     * @param coveredAmount The amount covered
     * @param productId The product ID
     * @param startDate The start date of coverage
     * @param endDate The end date of coverage
     * @param poolId The pool ID that issued this cover
     */
    function mintCoverNFT(
        address to,
        address coveredAccount,
        uint256 coveredAmount,
        uint64 productId,
        uint64 startDate,
        uint64 endDate,
        uint64 poolId
    ) external onlyRole(MINTER_ROLE) {
        uint256 coverId = coverIdCounter;
        coverIdCounter++;

        covers[coverId] = Cover({
            coveredAccount: coveredAccount,
            coveredAmount: coveredAmount,
            productId: productId,
            startDate: startDate,
            endDate: endDate,
            poolId: poolId
        });

        _mint(to, coverId);

        emit CoverNFTMinted(
            coverId,
            to,
            _msgSender(),
            coveredAccount,
            coveredAmount,
            productId,
            startDate,
            endDate
        );
    }

    /**
     * @dev Burn a cover NFT - can only be called by the NFT holder if cover has expired
     * @param coverId The ID of the cover NFT to burn
     * @return True if successful
     */
    function burnCoverNFT(uint256 coverId) external returns (bool) {
        require(
            _ownerOf(coverId) != address(0),
            "CoverNFT: Token does not exist"
        );

        require(
            ownerOf(coverId) == _msgSender(),
            "CoverNFT: Only the NFT holder can burn"
        );

        Cover memory cover = covers[coverId];
        require(
            block.timestamp > cover.endDate,
            "CoverNFT: Cover has not expired yet"
        );

        delete covers[coverId];

        // Burn the NFT
        _burn(coverId);

        emit CoverNFTBurned(coverId, cover.poolId);

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
        Cover memory cover = covers[tokenId];
        return uriDescriptor.tokenURI(tokenId, cover);
    }

    /**
     * @dev Sets the URI descriptor contract
     * @param _uriDescriptor The address of the new URI descriptor contract
     */
    function setUriDescriptor(
        address _uriDescriptor
    ) external onlyRole(MANAGER_ROLE) {
        address oldDescriptor = address(uriDescriptor);
        uriDescriptor = IUriDescriptor(_uriDescriptor);
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

    /**
     * @dev Override _transfer to make the NFT soulbound (non-transferable)
     * Only allows minting (from zero address) and burning (to zero address)
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public virtual override(ERC721Upgradeable, IERC721) {
        require(
            from == address(0) || to == address(0),
            "CoverNFT: Token is soulbound and cannot be transferred"
        );
        super.transferFrom(from, to, tokenId);
    }

    /**
     * @dev Override safeTransferFrom to make the NFT soulbound (non-transferable)
     */
    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public virtual override(ERC721Upgradeable, IERC721) {
        require(
            from == address(0) || to == address(0),
            "CoverNFT: Token is soulbound and cannot be transferred"
        );
        super.safeTransferFrom(from, to, tokenId, data);
    }
}
