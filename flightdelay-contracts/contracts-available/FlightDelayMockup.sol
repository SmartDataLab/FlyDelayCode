// SPDX-License-Identifier: Apache 2.0
pragma solidity 0.6.11;


// Mockup主要功能：
// 1. xxx
import "@etherisc/gif-interface/contracts/services/InstanceOperatorService.sol";
import "@etherisc/gif-interface/contracts/Product.sol";

contract FlightDelayMockup is Product {
    // 触发保单申请事件，与前端交互
    event LogAppliedForPolicy(
        bytes32 _carrierFlightNumber, // 航班号
        bytes32 _departureYearMonthDay, // 出发日期
        uint256 _departureTime, // 出发时间
        uint256 _arrivalTime, // 到达时间
        uint256[] _payoutOptions // 赔偿金额
    );

    bytes32 public constant NAME = "FlightDelayEtheriscOracle";
    bytes32 public constant VERSION = "0.1.11";
    bytes32 public constant POLICY_FLOW = "PolicyFlowDefault";

    // 初始化合约：主要是初始化Product合约
    constructor(address _productController)
    public
    Product(_productController, NAME, POLICY_FLOW) //
    {}

    function applyForPolicy(
    // domain specific
        bytes32 _carrierFlightNumber,
        bytes32 _departureYearMonthDay,
        uint256 _departureTime,
        uint256 _arrivalTime,
        uint256[] calldata _payoutOptions
    ) external payable {
        emit LogAppliedForPolicy(
            _carrierFlightNumber,
            _departureYearMonthDay,
            _departureTime,
            _arrivalTime,
            _payoutOptions
        );
    }

    function faucet() public onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

}
