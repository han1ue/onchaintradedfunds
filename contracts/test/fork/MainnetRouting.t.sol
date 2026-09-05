// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "../../src/interfaces/IERC20.sol";
import { OTFToken } from "../../src/OTFToken.sol";
import { OTFLaunchManager } from "../../src/OTFLaunchManager.sol";
import { OTFLaunchManagerDeployer } from "../../src/OTFLaunchManagerDeployer.sol";
import { OTFLaunchRouter } from "../../src/OTFLaunchRouter.sol";
import { OTFFactory } from "../../src/OTFFactory.sol";
import { ManagedOTFVault } from "../../src/ManagedOTFVault.sol";
import { VaultCreationParams } from "../../src/VaultTypes.sol";
import { BuybackCollector } from "../../src/BuybackCollector.sol";
import {
    OTFEntryExitRouter,
    BasketMintRequest,
    BasketRedeemRequest,
    SwapLeg
} from "../../src/OTFEntryExitRouter.sol";
import { UniswapV4Adapter } from "../../src/UniswapV4Adapter.sol";
import { UniswapV3Adapter } from "../../src/UniswapV3Adapter.sol";
import { UniswapV4PathKey, IPermit2AllowanceTransfer } from "../../src/interfaces/IUniswapV4.sol";
import { MockStockToken } from "../mocks/MockStockToken.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

interface ForkWeth is IERC20 {
    function deposit() external payable;
}

interface ForkV3Factory {
    function createPool(address, address, uint24) external returns (address);
}

interface ForkV3Pool {
    function initialize(uint160) external;
    function token0() external view returns (address);
    function token1() external view returns (address);
    function mint(address, int24, int24, uint128, bytes calldata)
        external
        returns (uint256, uint256);
}

/// @dev Only test tokens and protocol contracts are created locally. Venue code and storage come
///      from the pinned Robinhood mainnet fork; no venue call or response is mocked.
contract MainnetRoutingTest is Test {
    address private poolManager;
    address private stateView;
    address private positionManager;
    address private universalRouter;
    address private permit2;
    address private v3Factory;
    address private v3Router;
    address private mintingV3Pool;
    ForkWeth private weth;
    OTFToken private otf;
    OTFLaunchManager private launch;
    BuybackCollector private collector;
    OTFEntryExitRouter private router;
    UniswapV4Adapter private v4Adapter;
    UniswapV3Adapter private v3Adapter;
    ManagedOTFVault private vault;
    MockStockToken private assetA;
    MockStockToken private assetB;

    function setUp() public {
        string memory fixture = vm.readFile("../scripts/fixtures/robinhood-mainnet-routing.json");
        assertEq(block.number, vm.envUint("MAINNET_FORK_BLOCK"));
        assertEq(block.chainid, 4663);
        assertEq(block.chainid, vm.parseJsonUint(fixture, ".chainId"));
        poolManager = _dependency(fixture, "uniswapV4PoolManager");
        stateView = _dependency(fixture, "uniswapV4StateView");
        positionManager = _dependency(fixture, "uniswapV4PositionManager");
        universalRouter = _dependency(fixture, "uniswapUniversalRouter");
        permit2 = _dependency(fixture, "permit2");
        v3Factory = _dependency(fixture, "uniswapV3Factory");
        v3Router = _dependency(fixture, "uniswapV3SwapRouter02");
        weth = ForkWeth(_dependency(fixture, "weth"));
        vm.deal(address(this), 20_000 ether);
        weth.deposit{ value: 10_000 ether }();
        _deployProtocol();
        assetA = new MockStockToken("Fork asset A", "A", 18);
        assetB = new MockStockToken("Fork asset B", "B", 18);
        assetA.mint(address(this), 10_000 ether);
        assetB.mint(address(this), 10_000 ether);
        _seedV4(address(assetA));
        _seedV4(address(assetB));
        _seedV3(address(assetA));
        _seedV3(address(assetB));

        address[] memory assets = new address[](2);
        assets[0] = address(assetA);
        assets[1] = address(assetB);
        uint256[] memory units = new uint256[](2);
        units[0] = 1 ether;
        units[1] = 1 ether;
        vault = ManagedOTFVault(
            OTFFactory(router.factory())
                .createVault(
                    VaultCreationParams({
                    name: "Fork validation fund",
                    symbol: "FORK",
                    fundThesis: "Mainnet router validation.",
                    expenseBeneficiary: address(this),
                    annualCreatorExpenseRatioBps: 1_000,
                    mintFeeBps: 200,
                    redeemFeeBps: 100,
                    constituents: assets,
                    bootstrapBasketUnitsPerOTF: units
                })
                )
        );
        weth.approve(address(router), type(uint256).max);
        vault.approve(address(router), type(uint256).max);
    }

    function testV4BasketEntryExitAndRedemptionSettlement() public {
        _entryExitAndSettle(false, false);
    }

    function testV3BasketEntryExitAndRedemptionSettlement() public {
        _entryExitAndSettle(true, false);
    }

    function testV3NativeBasketEntryExit() public {
        _nativeEntryExit(true);
    }

    function testV4NativeBasketEntryExit() public {
        _nativeEntryExit(false);
    }

    function testMixedV3V4BasketEntryExit() public {
        SwapLeg[] memory entryLegs = _entryLegs(false);
        entryLegs[0] = _leg(address(weth), address(assetA), 1 ether, true);
        (uint256 shares,,) = router.mintFromToken(_mintRequest(), entryLegs);
        assertGt(shares, 0);
        _assertCleared();

        SwapLeg[] memory exitLegs = _exitLegs(false);
        exitLegs[0] = _leg(address(assetA), address(weth), type(uint256).max, true);
        uint256 beforeExit = weth.balanceOf(address(this));
        (uint256 received,,) = router.redeemToToken(
            BasketRedeemRequest(address(vault), address(weth), shares, 1, 0, block.timestamp),
            new uint256[](2),
            exitLegs
        );
        assertGt(received, 0);
        assertEq(weth.balanceOf(address(this)) - beforeExit, received);
        assertEq(vault.balanceOf(address(this)), 0);
        _assertCleared();
    }

    function _nativeEntryExit(bool v3) private {
        uint256 beforeBalance = address(this).balance;
        (uint256 shares,,,) =
            router.mintFromNative{ value: 2 ether }(_mintRequest(), _entryLegs(v3));
        assertGt(shares, 0);
        assertLt(address(this).balance, beforeBalance);
        _assertCleared();
        uint256 beforeExit = address(this).balance;
        (uint256 received,,) = router.redeemToNative(
            BasketRedeemRequest(address(vault), address(weth), shares, 1, 0, block.timestamp),
            new uint256[](2),
            _exitLegs(v3)
        );
        assertGt(received, 0);
        assertEq(address(this).balance - beforeExit, received);
        _assertCleared();
    }

    function testV3MinimumOutputRollback() public {
        uint256 beforeBalance = weth.balanceOf(address(this));
        SwapLeg[] memory legs = _entryLegs(true);
        legs[0].minAmountOut = 100 ether;
        vm.expectRevert();
        router.mintFromToken(_mintRequest(), legs);
        assertEq(weth.balanceOf(address(this)), beforeBalance);
        assertEq(vault.totalSupply(), 0);
        _assertCleared();
    }

    receive() external payable { }

    function testV4FeeShareSaleSettlement() public {
        _entryExitAndSettle(false, true);
    }

    function testV4MinimumOutputFailureRestoresBalancesAndApprovals() public {
        uint256 wethBefore = weth.balanceOf(address(this));
        SwapLeg[] memory legs = _entryLegs(false);
        legs[0].minAmountOut = 100 ether;
        vm.expectRevert();
        router.mintFromToken(_mintRequest(), legs);
        assertEq(weth.balanceOf(address(this)), wethBefore);
        assertEq(vault.totalSupply(), 0);
        _assertCleared();
    }

    function _entryExitAndSettle(bool v3, bool shareSale) private {
        uint256 wethBefore = weth.balanceOf(address(this));
        (uint256 shares,,) = router.mintFromToken(_mintRequest(), _entryLegs(v3));
        assertGt(shares, 0);
        assertEq(vault.balanceOf(address(this)), shares);
        assertLt(weth.balanceOf(address(this)), wethBefore);
        assertGt(vault.accountedBalance(address(assetA)), 0);
        assertGt(vault.accountedBalance(address(assetB)), 0);
        _assertCleared();

        uint256 exitBefore = weth.balanceOf(address(this));
        (uint256 received,,) = router.redeemToToken(
            BasketRedeemRequest(address(vault), address(weth), shares / 4, 1, 0, block.timestamp),
            new uint256[](2),
            _exitLegs(v3)
        );
        assertGt(received, 0);
        assertEq(weth.balanceOf(address(this)) - exitBefore, received);
        _assertCleared();

        vm.warp(block.timestamp + 30 days);
        assertGt(vault.checkpointFees(), 0);
        (uint256 creatorShares, uint256 buybackShares) = collector.feeAccounts(address(vault));
        assertGt(creatorShares, 0);
        assertGt(buybackShares, 0);
        if (shareSale) _seedV4(address(vault));
        uint256 supplyBefore = otf.totalSupply();
        uint256 beneficiaryBefore = weth.balanceOf(address(this));
        uint256 creatorWeth;
        uint256 buybackWeth;
        uint256 burned;
        if (shareSale) {
            SwapLeg[] memory legs = new SwapLeg[](1);
            legs[0] = _leg(address(vault), address(weth), type(uint256).max, false);
            (creatorWeth, buybackWeth, burned) =
                collector.settleFeesViaShareSale(address(vault), legs, 1, 1, block.timestamp);
        } else {
            (creatorWeth, buybackWeth, burned) = collector.settleFeesViaRedemption(
                address(vault), new uint256[](2), 0, _exitLegs(v3), 1, 1, block.timestamp
            );
        }
        assertGt(creatorWeth, 0);
        assertGt(buybackWeth, 0);
        assertGt(burned, 0);
        assertEq(weth.balanceOf(address(this)) - beneficiaryBefore, creatorWeth);
        assertEq(supplyBefore - otf.totalSupply(), burned);
        (creatorShares, buybackShares) = collector.feeAccounts(address(vault));
        assertEq(creatorShares + buybackShares, 0);
        assertEq(vault.balanceOf(address(collector)), 0);
        assertEq(otf.balanceOf(address(collector)), 0);
        assertEq(weth.balanceOf(address(collector)), 0);
        assertEq(weth.allowance(address(collector), permit2), 0);
        (uint160 allowance,,) = IPermit2AllowanceTransfer(permit2)
            .allowance(address(collector), address(weth), universalRouter);
        assertEq(allowance, 0);
        _assertCleared();
    }

    function _deployProtocol() private {
        otf = OTFToken(deployCode("OTFToken.sol:OTFToken", abi.encode(address(this))));
        OTFLaunchManagerDeployer deployer = OTFLaunchManagerDeployer(
            deployCode("OTFLaunchManagerDeployer.sol:OTFLaunchManagerDeployer")
        );
        bytes memory args = abi.encode(
            address(otf), address(weth), poolManager, stateView, positionManager, permit2
        );
        bytes32 initHash =
            keccak256(abi.encodePacked(vm.getCode("OTFLaunchManager.sol:OTFLaunchManager"), args));
        bytes32 salt;
        bool found;
        for (uint256 i; i < 1_000_000; i++) {
            salt = bytes32(i);
            if (
                uint160(vm.computeCreate2Address(salt, initHash, address(deployer))) & 0x3fff
                    == 0x2840
            ) {
                found = true;
                break;
            }
        }
        assertTrue(found);
        launch = deployer.deploy(
            salt, address(otf), address(weth), poolManager, stateView, positionManager, permit2
        );
        assertTrue(otf.approve(address(launch), launch.REQUIRED_OTF_BALANCE()));
        launch.initializeLaunch();
        OTFLaunchRouter launchRouter = OTFLaunchRouter(
            payable(deployCode("OTFLaunchRouter.sol:OTFLaunchRouter", abi.encode(address(launch))))
        );
        weth.approve(address(launchRouter), 20 ether);
        launchRouter.buyOtfWithWeth(20 ether, 1, address(this), block.timestamp);
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.Graduated));

        collector = BuybackCollector(
            deployCode(
                "BuybackCollector.sol:BuybackCollector",
                abi.encode(address(launch), universalRouter, permit2)
            )
        );
        address implementation = deployCode("ManagedOTFVault.sol:ManagedOTFVault");
        OTFFactory factory = OTFFactory(
            deployCode(
                "OTFFactory.sol:OTFFactory",
                abi.encode(implementation, address(collector), address(otf))
            )
        );
        collector.configureFactory(address(factory));
        router = OTFEntryExitRouter(
            payable(deployCode(
                    "OTFEntryExitRouter.sol:OTFEntryExitRouter",
                    abi.encode(address(factory), address(this), address(weth))
                ))
        );
        factory.configureEntryExitRouter(address(router));
        v4Adapter = UniswapV4Adapter(
            deployCode(
                "UniswapV4Adapter.sol:UniswapV4Adapter",
                abi.encode(address(router), poolManager, stateView, universalRouter, permit2)
            )
        );
        v3Adapter = UniswapV3Adapter(
            deployCode(
                "UniswapV3Adapter.sol:UniswapV3Adapter",
                abi.encode(address(router), v3Factory, v3Router)
            )
        );
        router.setAdapterApproved(address(v4Adapter), true);
        router.setAdapterApproved(address(v3Adapter), true);
    }

    function _seedV4(address token) private {
        PoolKey memory key = PoolKey(
            Currency.wrap(token < address(weth) ? token : address(weth)),
            Currency.wrap(token < address(weth) ? address(weth) : token),
            3000,
            60,
            IHooks(address(0))
        );
        IPoolManager(poolManager).initialize(key, uint160(1 << 96));
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(IPoolManager(poolManager));
        IERC20(token).approve(address(lp), type(uint256).max);
        weth.approve(address(lp), type(uint256).max);
        lp.modifyLiquidity(
            key,
            ModifyLiquidityParams(
                -887220,
                887220,
                token == address(vault) ? int256(0.1 ether) : int256(1000 ether),
                bytes32(0)
            ),
            bytes("")
        );
    }

    function _seedV3(address token) private {
        mintingV3Pool = ForkV3Factory(v3Factory).createPool(token, address(weth), 3000);
        ForkV3Pool(mintingV3Pool).initialize(uint160(1 << 96));
        ForkV3Pool(mintingV3Pool).mint(address(this), -887220, 887220, 1000 ether, bytes(""));
        mintingV3Pool = address(0);
    }

    function uniswapV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata) external {
        require(msg.sender == mintingV3Pool && msg.sender != address(0), "unexpected LP callback");
        assertTrue(IERC20(ForkV3Pool(msg.sender).token0()).transfer(msg.sender, amount0));
        assertTrue(IERC20(ForkV3Pool(msg.sender).token1()).transfer(msg.sender, amount1));
    }

    function _dependency(string memory fixture, string memory name)
        private
        view
        returns (address dependency)
    {
        string memory base = string.concat(".dependencies.", name);
        dependency = vm.parseJsonAddress(fixture, string.concat(base, ".address"));
        assertEq(
            dependency.codehash,
            vm.parseJsonBytes32(fixture, string.concat(base, ".codehash")),
            name
        );
    }

    function _mintRequest() private view returns (BasketMintRequest memory) {
        return BasketMintRequest(address(weth), address(vault), 2 ether, 0.9 ether, block.timestamp);
    }

    function _entryLegs(bool v3) private view returns (SwapLeg[] memory legs) {
        legs = new SwapLeg[](2);
        legs[0] = _leg(address(weth), address(assetA), 1 ether, v3);
        legs[1] = _leg(address(weth), address(assetB), 1 ether, v3);
    }

    function _exitLegs(bool v3) private view returns (SwapLeg[] memory legs) {
        legs = new SwapLeg[](2);
        legs[0] = _leg(address(assetA), address(weth), type(uint256).max, v3);
        legs[1] = _leg(address(assetB), address(weth), type(uint256).max, v3);
    }

    function _leg(address tokenIn, address tokenOut, uint256 amount, bool v3)
        private
        view
        returns (SwapLeg memory)
    {
        UniswapV4PathKey[] memory path = new UniswapV4PathKey[](1);
        path[0] = UniswapV4PathKey(tokenOut, 3000, 60, address(0), bytes(""));
        return SwapLeg(
            v3 ? address(v3Adapter) : address(v4Adapter),
            tokenIn,
            tokenOut,
            amount,
            1,
            v3 ? abi.encodePacked(tokenIn, uint24(3000), tokenOut) : abi.encode(path)
        );
    }

    function _assertCleared() private view {
        address[3] memory tokens = [address(weth), address(assetA), address(assetB)];
        for (uint256 i; i < tokens.length; i++) {
            assertEq(IERC20(tokens[i]).balanceOf(address(router)), 0);
            assertEq(IERC20(tokens[i]).balanceOf(address(v4Adapter)), 0);
            assertEq(IERC20(tokens[i]).balanceOf(address(v3Adapter)), 0);
            assertEq(IERC20(tokens[i]).allowance(address(v4Adapter), permit2), 0);
            assertEq(IERC20(tokens[i]).allowance(address(v3Adapter), v3Router), 0);
            (uint160 allowance,,) = IPermit2AllowanceTransfer(permit2)
                .allowance(address(v4Adapter), tokens[i], universalRouter);
            assertEq(allowance, 0);
        }
    }
}
