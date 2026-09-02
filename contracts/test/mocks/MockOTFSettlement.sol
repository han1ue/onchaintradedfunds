// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeTransferLib } from "../../src/libraries/SafeTransferLib.sol";

contract MockOTFSettlementFactory {
    address public buybackCollector;
    mapping(address => bool) public isVault;

    function setBuybackCollector(address collector) external {
        buybackCollector = collector;
    }

    function setVault(address vault, bool registered) external {
        isVault[vault] = registered;
    }
}

contract MockOTFSettlementVault is ERC20 {
    using SafeTransferLib for address;

    error UnauthorizedRouter(address caller);
    error InvalidArrayLength();
    error MinimumNotMet(uint256 index, uint256 minimum, uint256 actual);

    address[] private _assets;
    address public router;
    bool public failMint;
    bool public failRedeem;
    uint256 public checkpointCalls;
    uint256 public routerMintCalls;
    uint256 public routerRedeemCalls;

    constructor(string memory name_, string memory symbol_, address[] memory assets_)
        ERC20(name_, symbol_)
    {
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

    function checkpointFees() external returns (uint256 totalFeeShares) {
        checkpointCalls++;
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
        routerMintCalls++;
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
        routerRedeemCalls++;
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
