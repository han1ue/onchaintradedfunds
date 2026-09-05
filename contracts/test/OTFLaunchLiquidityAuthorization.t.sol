// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { OTFLaunchManager } from "../src/OTFLaunchManager.sol";
import { SafeTransferLib } from "../src/libraries/SafeTransferLib.sol";
import {
    UniswapV4PoolKey,
    UniswapV4SwapParams,
    UniswapV4ModifyLiquidityParams
} from "../src/interfaces/IUniswapV4.sol";

contract AuthorizationToken is ERC20 {
    constructor() ERC20("Launch test", "TEST") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}

/// @dev Calls the real hook inside the manager's synchronous mint authorization window.
contract AuthorizationDependencies {
    address public poolManager = address(this);
    uint256 public nextTokenId = 1;
    uint8 public mutation;
    uint160 public price;

    function setMutation(uint8 value) external {
        mutation = value;
    }

    function setPrice(uint160 value) external {
        price = value;
    }

    function initialize(UniswapV4PoolKey calldata, uint160 value) external returns (int24) {
        price = value;
        if (mutation == 10) revert("pool initialization failed");
        return 0;
    }

    function getSlot0(bytes32) external view returns (uint160, int24, uint24, uint24) {
        return (price, 0, 0, 0);
    }

    function approve(address, address, uint160, uint48) external { }

    function modifyLiquidities(bytes calldata data, uint256) external payable {
        OTFLaunchManager launch = OTFLaunchManager(msg.sender);
        (bytes memory actions, bytes[] memory inputs) = abi.decode(data, (bytes, bytes[]));
        if (actions[0] == 0x03) {
            AuthorizationToken(launch.weth()).mint(msg.sender, launch.bootstrapWethPrincipal());
            return;
        }
        (UniswapV4PoolKey memory key, int24 lower, int24 upper, uint256 liquidity) =
            abi.decode(inputs[0], (UniswapV4PoolKey, int24, int24, uint256));
        UniswapV4ModifyLiquidityParams memory params =
            UniswapV4ModifyLiquidityParams(lower, upper, int256(liquidity), bytes32(0));
        address sender = address(this);
        if (mutation == 1) sender = address(0xBAD);
        if (mutation == 2) key.fee++;
        if (mutation == 3) params.tickLower++;
        if (mutation == 4) params.tickUpper--;
        if (mutation == 5) params.liquidityDelta++;
        if (mutation == 6) params.liquidityDelta--;
        if (mutation == 7) params.liquidityDelta = 0;
        if (mutation == 8) params.liquidityDelta = -1;
        require(
            launch.beforeAddLiquidity(sender, key, params, bytes(""))
                == launch.beforeAddLiquidity.selector,
            "wrong selector"
        );
        if (mutation == 9) revert("mint failed after hook");
        if (launch.phase() == OTFLaunchManager.Phase.GraduationReady) {
            // Model the exact WETH debit without granting the mock an unrelated transfer path.
            AuthorizationToken(launch.weth())
                .transferFrom(msg.sender, address(this), launch.bootstrapWethPrincipal());
        }
        nextTokenId++;
    }
}

contract OTFLaunchLiquidityAuthorizationTest is Test {
    AuthorizationDependencies private dependencies;
    OTFLaunchManager private launch;
    AuthorizationToken private otf;

    function setUp() public {
        dependencies = new AuthorizationDependencies();
        otf = new AuthorizationToken();
        AuthorizationToken weth = new AuthorizationToken();
        deployCodeTo(
            "OTFLaunchManager.sol:OTFLaunchManager",
            abi.encode(
                address(otf),
                address(weth),
                address(dependencies),
                address(dependencies),
                address(dependencies),
                address(dependencies)
            ),
            address(0x2840)
        );
        launch = OTFLaunchManager(address(0x2840));
        otf.mint(address(this), launch.REQUIRED_OTF_BALANCE());
        otf.approve(address(launch), launch.REQUIRED_OTF_BALANCE());
    }

    function testApprovedFundedCallerCanInitializePermissionlessly() public {
        address caller = makeAddr("launch funder");
        uint256 required = launch.REQUIRED_OTF_BALANCE();
        otf.transfer(caller, required);
        vm.startPrank(caller);
        otf.approve(address(launch), required);
        launch.initializeLaunch();
        vm.stopPrank();

        assertEq(otf.balanceOf(caller), 0);
        assertEq(otf.allowance(caller, address(launch)), 0);
        assertEq(otf.balanceOf(address(launch)), required);
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
        assertEq(dependencies.price(), launch.initialSqrtPriceX96());
        assertEq(launch.bootstrapPositionTokenId(), 1);
        assertEq(launch.bootstrapLiquidity(), launch.BOOTSTRAP_LIQUIDITY());
    }

    function testInitializationRequiresFullCallerBalance() public {
        otf.transfer(address(0xBEEF), 1);
        vm.expectRevert(SafeTransferLib.SafeTransferFromFailed.selector);
        launch.initializeLaunch();
        assertEq(otf.balanceOf(address(this)), launch.REQUIRED_OTF_BALANCE() - 1);
        assertEq(otf.allowance(address(this), address(launch)), launch.REQUIRED_OTF_BALANCE());
        _assertInitializationRolledBack();
    }

    function testInitializationRequiresFullCallerAllowance() public {
        otf.approve(address(launch), 0);
        vm.expectRevert(SafeTransferLib.SafeTransferFromFailed.selector);
        launch.initializeLaunch();
        otf.approve(address(launch), launch.REQUIRED_OTF_BALANCE() - 1);
        vm.expectRevert(SafeTransferLib.SafeTransferFromFailed.selector);
        launch.initializeLaunch();
        assertEq(otf.balanceOf(address(this)), launch.REQUIRED_OTF_BALANCE());
        assertEq(otf.allowance(address(this), address(launch)), launch.REQUIRED_OTF_BALANCE() - 1);
        _assertInitializationRolledBack();
    }

    function testAnotherCallerCannotUseFundingWalletApproval() public {
        address caller = makeAddr("another caller");
        otf.mint(caller, launch.REQUIRED_OTF_BALANCE());
        vm.prank(caller);
        vm.expectRevert(SafeTransferLib.SafeTransferFromFailed.selector);
        launch.initializeLaunch();
        assertEq(otf.balanceOf(caller), launch.REQUIRED_OTF_BALANCE());
        assertEq(otf.balanceOf(address(this)), launch.REQUIRED_OTF_BALANCE());
        assertEq(otf.allowance(address(this), address(launch)), launch.REQUIRED_OTF_BALANCE());
        _assertInitializationRolledBack();
        launch.initializeLaunch();
        assertEq(otf.balanceOf(caller), launch.REQUIRED_OTF_BALANCE());
        assertEq(otf.balanceOf(address(this)), 0);
    }

    function testPrefundingCannotReplaceCallerFunding() public {
        uint256 required = launch.REQUIRED_OTF_BALANCE();
        otf.transfer(address(launch), required);
        vm.expectRevert(SafeTransferLib.SafeTransferFromFailed.selector);
        launch.initializeLaunch();
        assertEq(otf.balanceOf(address(launch)), required);
        assertEq(otf.balanceOf(address(this)), 0);
        assertEq(otf.allowance(address(this), address(launch)), required);
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.NotInitialized));
        assertEq(dependencies.price(), 0);
        assertEq(dependencies.nextTokenId(), 1);

        otf.mint(address(this), required);
        otf.approve(address(launch), 0);
        vm.expectRevert(SafeTransferLib.SafeTransferFromFailed.selector);
        launch.initializeLaunch();
        assertEq(otf.balanceOf(address(launch)), required);
        assertEq(otf.balanceOf(address(this)), required);
    }

    function testInitializationPullsFullAmountDespiteDonation() public {
        uint256 required = launch.REQUIRED_OTF_BALANCE();
        otf.mint(address(launch), required + 1);
        launch.initializeLaunch();
        assertEq(otf.balanceOf(address(this)), 0);
        assertEq(otf.allowance(address(this), address(launch)), 0);
        assertEq(otf.balanceOf(address(launch)), 2 * required + 1);
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
    }

    function testPoolInitializationFailureRollsBackFunding() public {
        _assertDownstreamFailureRollsBackFunding(10, bytes("pool initialization failed"));
    }

    function testLiquidityCreationFailureRollsBackFunding() public {
        _assertDownstreamFailureRollsBackFunding(9, bytes("mint failed after hook"));
    }

    function _assertDownstreamFailureRollsBackFunding(uint8 mutation, bytes memory reason) private {
        dependencies.setMutation(mutation);
        vm.expectRevert(reason);
        launch.initializeLaunch();
        assertEq(otf.balanceOf(address(this)), launch.REQUIRED_OTF_BALANCE());
        assertEq(otf.allowance(address(this), address(launch)), launch.REQUIRED_OTF_BALANCE());
        assertEq(otf.allowance(address(launch), address(dependencies)), 0);
        _assertInitializationRolledBack();
        _assertNoAuthorization(false);
        dependencies.setMutation(0);
        launch.initializeLaunch();
        assertEq(otf.balanceOf(address(this)), 0);
        assertEq(otf.allowance(address(this), address(launch)), 0);
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
    }

    function _assertInitializationRolledBack() private view {
        assertEq(otf.balanceOf(address(launch)), 0);
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.NotInitialized));
        assertEq(launch.bootstrapPositionTokenId(), 0);
        assertEq(launch.bootstrapLiquidity(), 0);
        assertEq(launch.bootstrapWethPrincipal(), 0);
        assertEq(launch.bootstrapOtfDeposited(), 0);
        assertEq(dependencies.price(), 0);
        assertEq(dependencies.nextTokenId(), 1);
    }

    function testHookPermissionsRequireExactNewMask() public {
        assertTrue(launch.hookPermissionsValid());
        vm.etch(address(0x2040), address(launch).code);
        assertFalse(OTFLaunchManager(address(0x2040)).hookPermissionsValid());
        vm.etch(address(0x2841), address(launch).code);
        assertFalse(OTFLaunchManager(address(0x2841)).hookPermissionsValid());
    }

    function testUnauthorizedCallerAndCanonicalPoolValidation() public {
        UniswapV4PoolKey memory key = _key();
        UniswapV4ModifyLiquidityParams memory params = _expectedParams(false);
        vm.expectRevert(
            abi.encodeWithSelector(OTFLaunchManager.UnauthorizedPoolManager.selector, address(this))
        );
        launch.beforeAddLiquidity(address(dependencies), key, params, bytes(""));
        key.currency0 = address(0xBAD);
        vm.prank(address(dependencies));
        vm.expectRevert(OTFLaunchManager.InvalidPool.selector);
        launch.beforeAddLiquidity(address(dependencies), key, params, bytes(""));
    }

    function testNoAuthorizationBeforeOrAfterBootstrapMint() public {
        _assertNoAuthorization(false);
        launch.initializeLaunch();
        assertEq(launch.bootstrapPositionTokenId(), 1);
        _assertNoAuthorization(false);
    }

    function testFuzzBootstrapMintRejectsMismatchedAuthorization(uint8 mutation) public {
        mutation = uint8(bound(mutation, 1, 8));
        dependencies.setMutation(mutation);
        vm.expectRevert(
            mutation == 2
                ? OTFLaunchManager.InvalidPool.selector
                : OTFLaunchManager.UnauthorizedLiquidityAddition.selector
        );
        launch.initializeLaunch();
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.NotInitialized));
        _assertNoAuthorization(false);
        dependencies.setMutation(0);
        launch.initializeLaunch();
        assertEq(launch.bootstrapPositionTokenId(), 1);
    }

    function testFuzzPermanentMintRejectsMismatchedAuthorization(uint8 mutation) public {
        launch.initializeLaunch();
        _ready();
        mutation = uint8(bound(mutation, 1, 8));
        dependencies.setMutation(mutation);
        vm.expectRevert(
            mutation == 2
                ? OTFLaunchManager.InvalidPool.selector
                : OTFLaunchManager.UnauthorizedLiquidityAddition.selector
        );
        launch.finalizeGraduation();
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.GraduationReady));
        assertEq(launch.permanentPositionTokenId(), 0);
        _assertNoAuthorization(true);
        dependencies.setMutation(0);
        launch.finalizeGraduation();
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.Graduated));
    }

    function testSynchronousMintFailuresRollBackAuthorization() public {
        dependencies.setMutation(9);
        vm.expectRevert(bytes("mint failed after hook"));
        launch.initializeLaunch();
        _assertNoAuthorization(false);
        dependencies.setMutation(0);
        launch.initializeLaunch();
        _ready();
        dependencies.setMutation(9);
        vm.expectRevert(bytes("mint failed after hook"));
        launch.finalizeGraduation();
        _assertNoAuthorization(true);
        dependencies.setMutation(0);
        launch.finalizeGraduation();
        assertEq(launch.permanentPositionTokenId(), 2);
    }

    function _ready() private {
        dependencies.setPrice(launch.finalSqrtPriceX96());
        UniswapV4PoolKey memory key = _key();
        vm.prank(address(dependencies));
        launch.afterSwap(address(this), key, UniswapV4SwapParams(false, -1, 1), 0, bytes(""));
    }

    function _assertNoAuthorization(bool permanent) private {
        UniswapV4PoolKey memory key = _key();
        UniswapV4ModifyLiquidityParams memory params = _expectedParams(permanent);
        vm.prank(address(dependencies));
        vm.expectRevert(OTFLaunchManager.UnauthorizedLiquidityAddition.selector);
        launch.beforeAddLiquidity(address(dependencies), key, params, bytes(""));
    }

    function _key() private view returns (UniswapV4PoolKey memory key) {
        (key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks) = launch.poolKey();
    }

    function _expectedParams(bool permanent)
        private
        view
        returns (UniswapV4ModifyLiquidityParams memory)
    {
        bool direct = launch.otfIsCurrency0();
        return UniswapV4ModifyLiquidityParams(
            permanent
                ? launch.FULL_RANGE_LOWER_TICK()
                : (direct ? launch.initialTick() : launch.finalTick()),
            permanent
                ? launch.FULL_RANGE_UPPER_TICK()
                : (direct ? launch.finalTick() : launch.initialTick()),
            int256(
                uint256(permanent ? launch.PERMANENT_LIQUIDITY() : launch.BOOTSTRAP_LIQUIDITY())
            ),
            bytes32(0)
        );
    }
}
