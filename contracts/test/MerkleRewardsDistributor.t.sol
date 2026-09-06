// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MerkleRewardsDistributor } from "../src/MerkleRewardsDistributor.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { TestBase } from "./TestBase.sol";

contract MerkleRewardsDistributorTest is TestBase {
    address private constant HOLDER = address(0xA11CE);
    address private constant PUBLISHER = address(0xCAFE);
    address private constant ALICE = address(0xB0B);
    address private constant BOB = address(0xBEEF);

    OTFToken private token;
    MerkleRewardsDistributor private distributor;

    function setUp() public {
        token = new OTFToken(HOLDER);
        distributor = new MerkleRewardsDistributor(address(token), PUBLISHER);
        vm.prank(HOLDER);
        token.transfer(address(distributor), 700_000_000 ether);
    }

    function testNewRootIsImmediateAndClaimsAreCumulativeAcrossSkippedVersions() public {
        bytes32 aliceLeaf = distributor.leafFor(ALICE, 100 ether);
        bytes32 bobLeaf = distributor.leafFor(BOB, 40 ether);
        bytes32 root = _hashPair(aliceLeaf, bobLeaf);
        vm.prank(PUBLISHER);
        distributor.setMerkleRoot(root);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = bobLeaf;
        assertEq(distributor.claim(ALICE, 100 ether, proof), 100 ether);
        assertEq(token.balanceOf(ALICE), 100 ether);
        assertEq(distributor.claimed(ALICE), 100 ether);

        vm.prank(PUBLISHER);
        distributor.setMerkleRoot(bytes32(uint256(123)));
        bytes32 newestLeaf = distributor.leafFor(ALICE, 250 ether);
        vm.prank(PUBLISHER);
        distributor.setMerkleRoot(newestLeaf);
        assertEq(distributor.rootVersion(), 3);
        assertEq(distributor.claim(ALICE, 250 ether, new bytes32[](0)), 150 ether);
        assertEq(token.balanceOf(ALICE), 250 ether);
    }

    function testAnyoneMaySubmitButCommittedAccountReceivesTokens() public {
        bytes32 leaf = distributor.leafFor(ALICE, 25 ether);
        vm.prank(PUBLISHER);
        distributor.setMerkleRoot(leaf);
        vm.prank(BOB);
        distributor.claim(ALICE, 25 ether, new bytes32[](0));
        assertEq(token.balanceOf(ALICE), 25 ether);
        assertEq(token.balanceOf(BOB), 0);
    }

    function testDoubleClaimsInvalidProofAndLowerCumulativeValuesFail() public {
        bytes32 leaf = distributor.leafFor(ALICE, 25 ether);
        vm.prank(PUBLISHER);
        distributor.setMerkleRoot(leaf);
        distributor.claim(ALICE, 25 ether, new bytes32[](0));
        vm.expectRevert(MerkleRewardsDistributor.NothingToClaim.selector);
        distributor.claim(ALICE, 25 ether, new bytes32[](0));
        vm.expectRevert(MerkleRewardsDistributor.InvalidProof.selector);
        distributor.claim(BOB, 25 ether, new bytes32[](0));
        vm.expectPartialRevert(MerkleRewardsDistributor.CumulativeEntitlementBelowClaimed.selector);
        distributor.claim(ALICE, 24 ether, new bytes32[](0));
    }

    function testPublisherCannotWithdrawRewardPrincipal() public {
        vm.prank(PUBLISHER);
        (bool success,) = address(distributor)
            .call(abi.encodeWithSignature("withdraw(address,uint256)", PUBLISHER, 1 ether));
        assertFalse(success);
        assertEq(token.balanceOf(address(distributor)), 700_000_000 ether);
    }

    function testFuzzGeneratedTreesCumulativeClaims(uint256 seed, uint8 depthSeed) public {
        uint256 n = 1 << (2 + depthSeed % 3);
        address[] memory users = new address[](n);
        uint256[] memory entitlement = new uint256[](n);
        uint256[] memory claimed = new uint256[](n);
        for (uint256 i; i < n; i++) {
            users[i] = address(uint160(0x10000 + i));
        }
        uint256 total;
        for (uint256 version; version < 4; version++) {
            bytes32[] memory tree = new bytes32[](2 * n - 1);
            for (uint256 i; i < n; i++) {
                entitlement[i] += 1 + uint256(keccak256(abi.encode(seed, version, i))) % 1_000 ether;
                tree[n - 1 + i] = keccak256(
                    bytes.concat(
                        keccak256(
                            abi.encode(
                                block.chainid, address(distributor), users[i], entitlement[i]
                            )
                        )
                    )
                );
                assertEq(tree[n - 1 + i], distributor.leafFor(users[i], entitlement[i]));
            }
            for (uint256 i = n - 1; i > 0; i--) {
                tree[i - 1] = _hashPair(tree[2 * i - 1], tree[2 * i]);
            }
            vm.prank(PUBLISHER);
            distributor.setMerkleRoot(tree[0]);
            for (uint256 i; i < n; i++) {
                // Some users skip arbitrary roots; everyone catches up on the final publication.
                if (version != 3 && (seed >> i) % 3 == version % 3) continue;
                bytes32[] memory proof = new bytes32[](2 + depthSeed % 3);
                uint256 node = n - 1 + i;
                for (uint256 level; node != 0; level++) {
                    proof[level] = tree[node % 2 == 1 ? node + 1 : node - 1];
                    node = (node - 1) / 2;
                }
                uint256 beforeSubmitter = token.balanceOf(BOB);
                vm.prank(BOB);
                assertEq(
                    distributor.claim(users[i], entitlement[i], proof), entitlement[i] - claimed[i]
                );
                total += entitlement[i] - claimed[i];
                claimed[i] = entitlement[i];
                assertEq(distributor.claimed(users[i]), claimed[i]);
                assertEq(token.balanceOf(users[i]), claimed[i]);
                assertEq(token.balanceOf(BOB), beforeSubmitter);
                vm.expectRevert(MerkleRewardsDistributor.NothingToClaim.selector);
                distributor.claim(users[i], entitlement[i], proof);
                vm.expectRevert(MerkleRewardsDistributor.InvalidProof.selector);
                distributor.claim(users[i], entitlement[i] + 1, proof);
            }
            assertEq(token.balanceOf(address(distributor)), 700_000_000 ether - total);
        }
        assertEq(distributor.rootVersion(), 4);
    }

    function testFuzzLeafDomainsAndFundingRollback(uint256 seed) public {
        uint256 amount = bound(seed, 1, 1_000 ether);
        MerkleRewardsDistributor other = new MerkleRewardsDistributor(address(token), PUBLISHER);
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(block.chainid, address(distributor), ALICE, amount)))
        );
        vm.prank(PUBLISHER);
        distributor.setMerkleRoot(leaf);
        vm.prank(PUBLISHER);
        other.setMerkleRoot(leaf);
        vm.expectRevert(MerkleRewardsDistributor.InvalidProof.selector);
        other.claim(ALICE, amount, new bytes32[](0));
        uint256 chain = block.chainid;
        vm.chainId(chain + 1);
        vm.expectRevert(MerkleRewardsDistributor.InvalidProof.selector);
        distributor.claim(ALICE, amount, new bytes32[](0));
        vm.chainId(chain);
        leaf = keccak256(bytes.concat(keccak256(abi.encode(chain, address(other), ALICE, amount))));
        vm.prank(PUBLISHER);
        other.setMerkleRoot(leaf);
        vm.prank(HOLDER);
        token.transfer(address(other), amount - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                MerkleRewardsDistributor.InsufficientRewardsBalance.selector, amount, amount - 1
            )
        );
        other.claim(ALICE, amount, new bytes32[](0));
        assertEq(other.claimed(ALICE), 0);
        assertEq(other.rootVersion(), 2);
        assertEq(other.merkleRoot(), leaf);
        assertEq(token.balanceOf(address(other)), amount - 1);
        assertEq(token.balanceOf(ALICE), 0);
        vm.prank(HOLDER);
        token.transfer(address(other), 1);
        assertEq(other.claim(ALICE, amount, new bytes32[](0)), amount);
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return
            uint256(a) < uint256(b) ? keccak256(bytes.concat(a, b)) : keccak256(bytes.concat(b, a));
    }
}
