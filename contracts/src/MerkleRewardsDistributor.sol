// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

/// @notice Immediate cumulative OTF claims from operator-published OpenZeppelin standard trees.
contract MerkleRewardsDistributor is Ownable2Step {
    using SafeTransferLib for address;

    uint256 public constant REWARDS_ALLOCATION = 700_000_000 ether;

    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidProof();
    error CumulativeEntitlementBelowClaimed(uint256 cumulativeEntitlement, uint256 claimed);
    error NothingToClaim();
    error InsufficientRewardsBalance(uint256 required, uint256 available);

    event MerkleRootPublished(bytes32 indexed root, uint256 indexed version, uint64 publishedAt);
    event Claimed(
        address indexed account,
        uint256 amount,
        uint256 cumulativeEntitlement,
        uint256 indexed rootVersion
    );

    address public immutable otf;
    bytes32 public merkleRoot;
    uint256 public rootVersion;
    uint64 public rootPublishedAt;
    mapping(address => uint256) public claimed;

    constructor(address otf_, address rootPublisher) Ownable(rootPublisher) {
        if (otf_ == address(0) || rootPublisher == address(0)) revert ZeroAddress();
        if (otf_.code.length == 0) revert InvalidDependency(otf_);
        otf = otf_;
    }

    function setMerkleRoot(bytes32 newRoot) external onlyOwner {
        merkleRoot = newRoot;
        rootVersion++;
        rootPublishedAt = uint64(block.timestamp);
        emit MerkleRootPublished(newRoot, rootVersion, rootPublishedAt);
    }

    function leafFor(address account, uint256 cumulativeEntitlement) public view returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(abi.encode(block.chainid, address(this), account, cumulativeEntitlement))
            )
        );
    }

    function claim(address account, uint256 cumulativeEntitlement, bytes32[] calldata proof)
        external
        returns (uint256 amount)
    {
        uint256 previouslyClaimed = claimed[account];
        if (cumulativeEntitlement < previouslyClaimed) {
            revert CumulativeEntitlementBelowClaimed(cumulativeEntitlement, previouslyClaimed);
        }
        if (!MerkleProof.verifyCalldata(proof, merkleRoot, leafFor(account, cumulativeEntitlement)))
        {
            revert InvalidProof();
        }
        amount = cumulativeEntitlement - previouslyClaimed;
        if (amount == 0) revert NothingToClaim();
        uint256 available = IERC20(otf).balanceOf(address(this));
        if (amount > available) revert InsufficientRewardsBalance(amount, available);
        claimed[account] = cumulativeEntitlement;
        otf.safeTransfer(account, amount);
        emit Claimed(account, amount, cumulativeEntitlement, rootVersion);
    }
}
