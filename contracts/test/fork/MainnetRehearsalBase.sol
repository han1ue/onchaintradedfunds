// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { OTFToken } from "../../src/OTFToken.sol";
import { OTFLaunchManager } from "../../src/OTFLaunchManager.sol";
import { OTFLaunchManagerDeployer } from "../../src/OTFLaunchManagerDeployer.sol";
import { OTFLaunchRouter } from "../../src/OTFLaunchRouter.sol";
import { OTFFactory } from "../../src/OTFFactory.sol";
import { ManagedOTFVault } from "../../src/ManagedOTFVault.sol";
import { BuybackCollector } from "../../src/BuybackCollector.sol";
import { OTFEntryExitRouter } from "../../src/OTFEntryExitRouter.sol";
import { UniswapV3Adapter } from "../../src/UniswapV3Adapter.sol";
import { UniswapV4Adapter } from "../../src/UniswapV4Adapter.sol";
import { TeamMarketCapVesting } from "../../src/TeamMarketCapVesting.sol";
import { MerkleRewardsDistributor } from "../../src/MerkleRewardsDistributor.sol";
import { IERC20 } from "../../src/interfaces/IERC20.sol";
import { AggregatorV3Interface } from "../../src/interfaces/AggregatorV3Interface.sol";

interface RehearsalWeth is IERC20 {
    function deposit() external payable;
}

interface RehearsalOracle is AggregatorV3Interface {
    function aggregator() external view returns (address);
}

/// @dev All deployed dependencies retain their mainnet code and storage. Only ETH balances
///      for explicitly named rehearsal accounts are funded with cheatcodes.
abstract contract MainnetRehearsalBase is Test {
    address internal deployer;
    address internal administrator;
    address internal beneficiary;
    address internal investor;
    address internal poolManager;
    address internal stateView;
    address internal positionManager;
    address internal universalRouter;
    address internal permit2;
    address internal v3Factory;
    address internal v3Router;
    RehearsalWeth internal weth;
    RehearsalOracle internal oracle;
    uint256 internal oracleMaxAge;
    string internal rehearsal;
    OTFToken internal otf;
    OTFLaunchManagerDeployer internal launchDeployer;
    OTFLaunchManager internal launch;
    OTFLaunchRouter internal launchRouter;
    BuybackCollector internal collector;
    OTFFactory internal factory;
    ManagedOTFVault internal implementation;
    OTFEntryExitRouter internal router;
    UniswapV3Adapter internal v3Adapter;
    UniswapV4Adapter internal v4Adapter;
    TeamMarketCapVesting internal vesting;
    MerkleRewardsDistributor internal rewards;
    bytes32 internal launchSalt;
    bytes32 internal launchInitCodeHash;
    uint256 internal startingNonce;

    function setUp() public virtual {
        assertEq(block.chainid, 4663);
        assertEq(block.number, vm.envUint("MAINNET_FORK_BLOCK"));
        string memory routing = vm.readFile("../scripts/fixtures/robinhood-mainnet-routing.json");
        rehearsal = vm.readFile("../scripts/fixtures/robinhood-mainnet-rehearsal.json");
        poolManager = _pinned(routing, ".dependencies.uniswapV4PoolManager");
        stateView = _pinned(routing, ".dependencies.uniswapV4StateView");
        positionManager = _pinned(routing, ".dependencies.uniswapV4PositionManager");
        universalRouter = _pinned(routing, ".dependencies.uniswapUniversalRouter");
        permit2 = _pinned(routing, ".dependencies.permit2");
        v3Factory = _pinned(routing, ".dependencies.uniswapV3Factory");
        v3Router = _pinned(routing, ".dependencies.uniswapV3SwapRouter02");
        weth = RehearsalWeth(_pinned(routing, ".dependencies.weth"));
        oracle = RehearsalOracle(_pinned(rehearsal, ".oracle"));
        assertEq(oracle.aggregator(), _pinned(rehearsal, ".oracle.aggregator"));
        oracleMaxAge = vm.parseJsonUint(rehearsal, ".oracle.maxAgeSeconds");
        assertEq(oracle.decimals(), vm.parseJsonUint(rehearsal, ".oracle.decimals"));
        assertEq(oracle.description(), "ETH / USD");

        deployer = makeAddr("mainnet rehearsal deployer");
        administrator = makeAddr("mainnet rehearsal protocol administrator");
        beneficiary = makeAddr("mainnet rehearsal team beneficiary");
        investor = makeAddr("mainnet rehearsal investor");
        vm.deal(deployer, 100 ether);
        vm.deal(administrator, 100 ether);
        vm.deal(beneficiary, 100 ether);
        vm.deal(investor, 100 ether);
        startingNonce = vm.getNonce(deployer);
        _deployAndConfigure();
    }

    function _deployAndConfigure() private {
        // CREATE executes real constructors as the rehearsal deployer. No runtime is etched.
        vm.startPrank(deployer);
        otf = OTFToken(deployCode("OTFToken.sol:OTFToken", abi.encode(deployer)));
        launchDeployer = OTFLaunchManagerDeployer(
            deployCode("OTFLaunchManagerDeployer.sol:OTFLaunchManagerDeployer")
        );
        bytes memory args = abi.encode(
            address(otf), address(weth), poolManager, stateView, positionManager, permit2
        );
        launchInitCodeHash =
            keccak256(abi.encodePacked(vm.getCode("OTFLaunchManager.sol:OTFLaunchManager"), args));
        bool found;
        for (uint256 i; i < 1_000_000; ++i) {
            launchSalt = bytes32(i);
            if (
                uint160(
                            vm.computeCreate2Address(
                                launchSalt, launchInitCodeHash, address(launchDeployer)
                            )
                        ) & 0x3fff == 0x2840
            ) {
                found = true;
                break;
            }
        }
        assertTrue(found, "No valid hook salt");
        launch = launchDeployer.deploy(
            launchSalt,
            address(otf),
            address(weth),
            poolManager,
            stateView,
            positionManager,
            permit2
        );
        launchRouter = OTFLaunchRouter(
            payable(deployCode("OTFLaunchRouter.sol:OTFLaunchRouter", abi.encode(address(launch))))
        );
        collector = BuybackCollector(
            deployCode(
                "BuybackCollector.sol:BuybackCollector",
                abi.encode(address(launch), universalRouter, permit2)
            )
        );
        implementation = ManagedOTFVault(deployCode("ManagedOTFVault.sol:ManagedOTFVault"));
        factory = OTFFactory(
            deployCode(
                "OTFFactory.sol:OTFFactory",
                abi.encode(address(implementation), address(collector), address(otf))
            )
        );
        router = OTFEntryExitRouter(
            payable(deployCode(
                    "OTFEntryExitRouter.sol:OTFEntryExitRouter",
                    abi.encode(address(factory), administrator, address(weth))
                ))
        );
        v3Adapter = UniswapV3Adapter(
            deployCode(
                "UniswapV3Adapter.sol:UniswapV3Adapter",
                abi.encode(address(router), v3Factory, v3Router)
            )
        );
        v4Adapter = UniswapV4Adapter(
            deployCode(
                "UniswapV4Adapter.sol:UniswapV4Adapter",
                abi.encode(address(router), poolManager, stateView, universalRouter, permit2)
            )
        );
        vesting = TeamMarketCapVesting(
            deployCode(
                "TeamMarketCapVesting.sol:TeamMarketCapVesting",
                abi.encode(address(launch), address(oracle), oracleMaxAge, beneficiary)
            )
        );
        rewards = MerkleRewardsDistributor(
            deployCode(
                "MerkleRewardsDistributor.sol:MerkleRewardsDistributor",
                abi.encode(address(otf), administrator)
            )
        );
        collector.configureFactory(address(factory));
        factory.configureEntryExitRouter(address(router));
        assertTrue(otf.approve(address(launch), launch.REQUIRED_OTF_BALANCE()));
        assertTrue(otf.transfer(address(vesting), 100_000_000 ether));
        assertTrue(otf.transfer(address(rewards), 700_000_000 ether));
        vm.stopPrank();

        // The administrator is deliberately different from the deployer.
        vm.startPrank(administrator);
        router.setAdapterApproved(address(v3Adapter), true);
        router.setAdapterApproved(address(v4Adapter), true);
        vm.stopPrank();
    }

    function _graduate() internal {
        vm.prank(deployer);
        launch.initializeLaunch();
        vm.prank(investor);
        launchRouter.buyOtfWithEth{ value: 20 ether }(1, investor, block.timestamp);
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.Graduated));
    }

    function _pinned(string memory fixture, string memory path)
        internal
        view
        returns (address dependency)
    {
        dependency = vm.parseJsonAddress(fixture, string.concat(path, ".address"));
        assertGt(dependency.code.length, 0, path);
        assertEq(
            dependency.codehash,
            vm.parseJsonBytes32(fixture, string.concat(path, ".codehash")),
            path
        );
    }
}
