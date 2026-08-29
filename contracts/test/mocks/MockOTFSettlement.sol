// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Base } from "../../src/ERC20Base.sol";
import { SafeTransferLib } from "../../src/libraries/SafeTransferLib.sol";

contract MockOTFSettlementFactory {
    mapping(address => bool) public isVault;

    function setVault(address vault, bool registered) external {
        isVault[vault] = registered;
    }
}

contract MockOTFSettlementVault is ERC20Base {
    using SafeTransferLib for address;

    error UnauthorizedRouter(address caller);
    error InvalidArrayLength();
    error MinimumNotMet(uint256 index, uint256 minimum, uint256 actual);

    address[] private _assets;
    address public router;
    bool public failMint;
    bool public failRedeem;

    constructor(string memory name_, string memory symbol_, address[] memory assets_) {
        _initializeERC20(name_, symbol_, 18);
        _assets = assets_;
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert UnauthorizedRouter(msg.sender);
        _;
    }

    function setRouter(address router_) external {
        require(router == address(0), "ROUTER_SET");
        router = router_;
    }

    function setFailure(bool mintFailure, bool redeemFailure) external {
        failMint = mintFailure;
        failRedeem = redeemFailure;
    }

    function seedShares(address receiver, uint256 shares) external {
        _mint(receiver, shares);
    }

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function checkpointFees() external pure returns (uint256 totalFeeShares) {
        return 0;
    }

    function previewMaxMint(uint256[] calldata maxAmountsIn)
        external
        pure
        returns (uint256 shares, uint256[] memory amountsIn)
    {
        if (maxAmountsIn.length == 0) return (0, new uint256[](0));
        shares = type(uint256).max;
        amountsIn = new uint256[](maxAmountsIn.length);
        for (uint256 i = 0; i < maxAmountsIn.length; i++) {
            if (maxAmountsIn[i] < shares) shares = maxAmountsIn[i];
        }
        for (uint256 i = 0; i < maxAmountsIn.length; i++) {
            amountsIn[i] = shares;
        }
    }

    function routerMint(uint256 shares, address receiver, uint256[] calldata maxAmountsIn)
        external
        onlyRouter
        returns (uint256[] memory amountsIn)
    {
        require(!failMint, "MINT_FAILED");
        if (maxAmountsIn.length != _assets.length) revert InvalidArrayLength();
        amountsIn = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            if (maxAmountsIn[i] < shares) {
                revert MinimumNotMet(i, shares, maxAmountsIn[i]);
            }
            amountsIn[i] = shares;
            _assets[i].safeTransferFrom(msg.sender, address(this), shares);
        }
        _mint(receiver, shares);
    }

    function routerRedeem(
        uint256 shares,
        address owner,
        address receiver,
        uint256[] calldata minAmountsOut
    ) external onlyRouter returns (uint256[] memory amountsOut) {
        require(!failRedeem, "REDEEM_FAILED");
        if (minAmountsOut.length != _assets.length) revert InvalidArrayLength();
        _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        amountsOut = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            if (shares < minAmountsOut[i]) {
                revert MinimumNotMet(i, minAmountsOut[i], shares);
            }
            amountsOut[i] = shares;
            _assets[i].safeTransfer(receiver, shares);
        }
    }
}
