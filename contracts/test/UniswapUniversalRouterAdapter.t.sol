// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";
import { MockPermit2 } from "./mocks/MockUniswapV4.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { UniswapUniversalRouterAdapter } from "../src/UniswapUniversalRouterAdapter.sol";
import { ITradeAdapter } from "../src/interfaces/ITradeAdapter.sol";
import { SwapLeg, BasketMintRequest, BasketRedeemRequest } from "../src/OTFEntryExitRouter.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UniversalRouter } from "@uniswap/universal-router/contracts/UniversalRouter.sol";
import { RouterParameters } from "@uniswap/universal-router/contracts/types/RouterParameters.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { StateView } from "@uniswap/v4-periphery/src/lens/StateView.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

interface BatchV3Callback { function uniswapV3SwapCallback(int256, int256, bytes calldata) external; }

contract BatchV3Pool {
    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    constructor() { factory = msg.sender; (token0, token1, fee) = BatchV3Factory(msg.sender).parameters(); }
    function swap(address recipient, bool zeroForOne, int256 amount, uint160, bytes calldata data) external returns (int256 a, int256 b) {
        require(amount > 0);
        (a,b) = zeroForOne ? (amount, -amount) : (-amount, amount);
        address input = zeroForOne ? token0 : token1;
        uint256 before = IERC20(input).balanceOf(address(this));
        IERC20(zeroForOne ? token1 : token0).transfer(recipient, uint256(amount));
        BatchV3Callback(msg.sender).uniswapV3SwapCallback(a,b,data);
        require(IERC20(input).balanceOf(address(this)) == before + uint256(amount));
    }
}

contract BatchV3Factory {
    address public a;
    address public b;
    uint24 public f;
    mapping(bytes32 => address) private pools;
    function parameters() external view returns (address,address,uint24) { return(a,b,f); }
    function getPool(address x,address y,uint24 fee) external view returns(address) { return pools[_key(x,y,fee)]; }
    function createPool(address x,address y,uint24 fee) external returns(address pool) {
        bytes32 key = _key(x,y,fee);
        if (pools[key] != address(0)) return pools[key];
        (a,b) = x < y ? (x,y) : (y,x); f = fee;
        pool = address(new BatchV3Pool{salt:key}()); pools[key] = pool;
    }
    function _key(address x,address y,uint24 fee) private pure returns(bytes32) { return x < y ? keccak256(abi.encode(x,y,fee)) : keccak256(abi.encode(y,x,fee)); }
}

contract UniswapUniversalRouterAdapterTest is AtomicRouterTestBase {
    BatchV3Factory private factory;
    PoolManager private manager;
    UniversalRouter private universal;
    UniswapUniversalRouterAdapter private adapter;
    MockPermit2 private permit;

    receive() external payable { }

    function setUp() public {
        _setUpAtomicRouter();
        factory = new BatchV3Factory();
        manager = new PoolManager(address(this));
        StateView state = new StateView(manager);
        permit = new MockPermit2();
        universal = new UniversalRouter(RouterParameters(address(permit),address(weth),address(0),address(factory),bytes32(0),keccak256(type(BatchV3Pool).creationCode),address(manager),address(0),address(0),address(0)));
        adapter = new UniswapUniversalRouterAdapter(address(router),address(factory),keccak256(type(BatchV3Pool).creationCode),address(manager),address(state),address(universal),address(permit));
        router.setAdapterApproved(address(adapter),true);
        _pool(address(input),address(assetA));
        _pool(address(assetA),address(assetC));
        _pool(address(assetA),address(assetD));
        _pool(address(input),address(assetC));
        _pool(address(input),address(assetD));
        _pool(address(weth),address(assetC));
        _pool(address(weth),address(assetD));
        _v4Pool(address(weth),address(assetD));
        _v4Pool(address(0),address(assetC));
    }

    function testSharedIntermediateBatchMintsAndRefundsWithoutUsingDust() public {
        input.mint(address(adapter),13);
        assetA.mint(address(adapter),17);
        assetA.mint(address(universal),19);
        input.mint(address(router),23);
        SwapLeg[] memory legs = new SwapLeg[](3);
        legs[0] = _v3(address(input),address(assetA),2 * ONE + 1,2 * ONE + 1);
        legs[1] = _v3(address(assetA),address(assetC),ONE,ONE);
        legs[2] = _v3(address(assetA),address(assetD),ONE,ONE);
        vm.prank(ALICE);
        (uint256 shares,,) = router.mintFromToken(_mintRequest(2 * ONE + 1,ONE),legs);
        assertEq(shares,ONE);
        assertEq(assetA.balanceOf(ALICE),1);
        assertEq(assetA.balanceOf(address(universal)),19);
        assertEq(assetA.balanceOf(address(adapter)),17);
        assertEq(input.balanceOf(address(adapter)),13);
        assertEq(input.balanceOf(address(router)),23);
        assertEq(assetC.balanceOf(address(targetVault)),ONE);
        assertEq(assetD.balanceOf(address(targetVault)),ONE);
    }

    function testMixedV3V4AndNativeCurrencyPreserveRouterReserves() public {
        vm.deal(address(universal),11);
        weth.mint(address(universal),13);
        vm.deal(ALICE,3 * ONE);
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _v4(address(0),address(assetC),ONE,ONE * 99 / 100);
        legs[1] = _v3(address(weth),address(assetD),type(uint256).max,ONE);
        vm.prank(ALICE);
        (uint256 shares,,,) = router.mintFromNative{value:2 * ONE}(_nativeMint(2 * ONE),legs);
        assertTrue(shares > ONE * 99 / 100);
        assertEq(address(universal).balance,11);
        assertEq(weth.balanceOf(address(universal)),13);
        assertEq(weth.allowance(address(adapter),address(permit)),0);
        (uint160 allowed,,) = permit.allowance(address(adapter),address(weth),address(universal));
        assertEq(uint256(allowed),0);
        _assertRouterClean();
    }

    function testBatchedV4AndNativeExit() public {
        vm.deal(ALICE,3 * ONE);
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _v4(address(0),address(assetC),ONE,1);
        legs[1] = _v4(address(weth),address(assetD),type(uint256).max,1);
        vm.prank(ALICE);
        (uint256 shares,,,) = router.mintFromNative{value:2 * ONE}(_nativeMint(2 * ONE),legs);
        legs[0] = _v4(address(assetC),address(0),type(uint256).max,1);
        legs[1] = _v4(address(assetD),address(weth),type(uint256).max,1);
        vm.startPrank(ALICE);
        targetVault.approve(address(router),shares);
        BasketRedeemRequest memory request = BasketRedeemRequest(address(targetVault),address(weth),shares,1,0,block.timestamp);
        (uint256 received,,) = router.redeemToNative(request,_zeroMinimums(),legs);
        vm.stopPrank();
        assertTrue(received > ONE);
        assertEq(targetVault.balanceOf(ALICE),0);
        _assertRouterClean();
    }

    function testUnauthorizedAndMinimumFailureAreAtomic() public {
        ITradeAdapter.Trade[] memory trades = new ITradeAdapter.Trade[](1);
        trades[0] = ITradeAdapter.Trade(address(input),address(assetC),ONE,ONE,_v3(address(input),address(assetC),ONE,ONE).data);
        address[] memory tokens = adapter.routeTokens(trades);
        vm.expectPartialRevert(UniswapUniversalRouterAdapter.UnauthorizedCaller.selector);
        adapter.executeBatch(trades,tokens,new uint256[](tokens.length),block.timestamp);
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _v3(address(input),address(assetC),ONE,ONE);
        legs[1] = _v3(address(input),address(assetD),ONE,ONE + 1);
        uint256 before = input.balanceOf(ALICE);
        vm.prank(ALICE);
        vm.expectRevert();
        router.mintFromToken(_mintRequest(2 * ONE,ONE),legs);
        assertEq(input.balanceOf(ALICE),before);
        assertEq(targetVault.totalSupply(),0);
        _assertRouterClean();
    }

    function testIndependentPairsAndMultihopShareOneBatch() public {
        ITradeAdapter.Trade[] memory trades = new ITradeAdapter.Trade[](2);
        trades[0] = ITradeAdapter.Trade(address(input),address(assetC),ONE,ONE,abi.encodePacked(hex"03",address(input),FEE,address(assetA),FEE,address(assetC)));
        trades[1] = ITradeAdapter.Trade(address(weth),address(assetD),2 * ONE,2 * ONE,_v3(address(weth),address(assetD),2 * ONE,2 * ONE).data);
        address[] memory tokens = adapter.routeTokens(trades);
        uint256[] memory funding = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i] == address(input)) funding[i] = ONE;
            if (tokens[i] == address(weth)) funding[i] = 2 * ONE;
            if (funding[i] != 0) MockStockToken(tokens[i]).mint(address(adapter),funding[i]);
        }
        assetA.mint(address(universal),17);
        vm.prank(address(router));
        adapter.executeBatch(trades,tokens,funding,block.timestamp);
        assertEq(assetC.balanceOf(address(router)),ONE);
        assertEq(assetD.balanceOf(address(router)),2 * ONE);
        assertEq(assetA.balanceOf(address(universal)),17);
        assertEq(input.balanceOf(address(adapter)),0);
        assertEq(weth.allowance(address(adapter),address(permit)),0);
    }

    function testFuzzRepeatedTokenAndRoundingRefund(uint96 quantity, uint8 remainder) public {
        uint256 amount = uint256(quantity) % (100 * ONE) + 1;
        SwapLeg[] memory legs = new SwapLeg[](4);
        legs[0] = _v3(address(input),address(assetA),amount * 2 + remainder,amount * 2 + remainder);
        legs[1] = _v3(address(assetA),address(input),amount,amount);
        legs[2] = _v3(address(input),address(assetC),amount,amount);
        legs[3] = _v3(address(assetA),address(assetD),amount,amount);
        vm.prank(ALICE);
        (uint256 shares,,) = router.mintFromToken(_mintRequest(amount * 2 + remainder,amount),legs);
        assertEq(shares,amount);
        assertEq(assetA.balanceOf(ALICE),remainder);
        _assertRouterClean();
    }

    function testMalformedEndpointUnknownPoolAndSentinelAmountsRevert() public {
        SwapLeg[] memory legs = new SwapLeg[](1);
        legs[0] = _v3(address(input),address(assetC),ONE,ONE);
        legs[0].data = abi.encodePacked(hex"03",address(assetA),FEE,address(assetC));
        vm.prank(ALICE); vm.expectRevert();
        router.mintFromToken(_mintRequest(ONE,1),legs);
        legs[0] = _v3(address(input),address(assetB),ONE,ONE);
        vm.prank(ALICE); vm.expectPartialRevert(UniswapUniversalRouterAdapter.UnauthenticatedPool.selector);
        router.mintFromToken(_mintRequest(ONE,1),legs);
        legs[0] = _v3(address(input),address(assetC),1 << 255,ONE);
        vm.prank(ALICE); vm.expectPartialRevert(UniswapUniversalRouterAdapter.InvalidPlan.selector);
        router.mintFromToken(_mintRequest(ONE,1),legs);
        assertEq(targetVault.totalSupply(),0);
    }

    function testSkippedIntermediateIsRejectedBeforeSettlement() public {
        SwapLeg[] memory legs = new SwapLeg[](1);
        legs[0] = SwapLeg(address(adapter),address(assetB),address(input),ONE,ONE,abi.encodePacked(hex"03",address(assetB),FEE,address(assetA),FEE,address(input)));
        BasketRedeemRequest memory request = BasketRedeemRequest(address(sourceVault),address(input),ONE,1,1,block.timestamp);
        vm.prank(ALICE); vm.expectRevert();
        router.redeemToToken(request,_zeroMinimums(),legs);
        assertEq(sourceVault.balanceOf(ALICE),10_000 * ONE);
    }

    function testBatchDeadlineRejectsBeforeExecution() public {
        ITradeAdapter.Trade[] memory trades = new ITradeAdapter.Trade[](1);
        trades[0] = ITradeAdapter.Trade(address(input),address(assetC),ONE,ONE,_v3(address(input),address(assetC),ONE,ONE).data);
        address[] memory tokens = adapter.routeTokens(trades);
        vm.prank(address(router));vm.expectPartialRevert(UniswapUniversalRouterAdapter.DeadlineExpired.selector);
        adapter.executeBatch(trades,tokens,new uint256[](tokens.length),block.timestamp-1);
    }

    function _nativeMint(uint256 amount) private view returns(BasketMintRequest memory request) { request=_mintRequest(amount,1); request.inputToken=address(weth); }
    function _v3(address a,address b,uint256 amount,uint256 minimum) private view returns(SwapLeg memory) { return SwapLeg(address(adapter),a,b,amount,minimum,abi.encodePacked(hex"03",a,FEE,b)); }
    function _v4(address a,address b,uint256 amount,uint256 minimum) private view returns(SwapLeg memory) {
        PathKey[] memory path = new PathKey[](1);
        path[0] = PathKey(Currency.wrap(b),3000,60,IHooks(address(0)),"");
        return SwapLeg(address(adapter),a==address(0)?address(weth):a,b==address(0)?address(weth):b,amount,minimum,bytes.concat(hex"04",abi.encode(a,path)));
    }
    function _pool(address a,address b) private {
        address pool=factory.createPool(a,b,FEE);
        MockStockToken(a).mint(pool,1000 * ONE);
        MockStockToken(b).mint(pool,1000 * ONE);
    }
    function _v4Pool(address a,address b) private {
        (a,b)=a < b ? (a,b):(b,a);
        PoolKey memory key=PoolKey(Currency.wrap(a),Currency.wrap(b),3000,60,IHooks(address(0)));
        manager.initialize(key,uint160(1 << 96));
        PoolModifyLiquidityTest lp=new PoolModifyLiquidityTest(manager);
        if(a!=address(0)){MockStockToken(a).mint(address(this),1000 * ONE);IERC20(a).approve(address(lp),type(uint256).max);}
        MockStockToken(b).mint(address(this),1000 * ONE); IERC20(b).approve(address(lp),type(uint256).max);
        vm.deal(address(this),1000 * ONE);
        lp.modifyLiquidity{value:a==address(0)?1000 * ONE:0}(key,ModifyLiquidityParams(-600,600,10000 ether,bytes32(0)),"");
    }
}
