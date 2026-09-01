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

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return
            uint256(a) < uint256(b) ? keccak256(bytes.concat(a, b)) : keccak256(bytes.concat(b, a));
    }
}
