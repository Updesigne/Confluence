// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20M {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

contract MockVenue {
    struct Position {
        address asset;
        uint256 principal;
        uint256 profit;
        uint256 maturity;
        bool redeemed;
    }

    address public immutable owner;
    uint256 public nextId = 1;
    mapping(uint256 => Position) public positions;

    constructor() {
        owner = msg.sender;
    }

    function fundRewards(address asset, uint256 amount) external {
        require(msg.sender == owner, "owner");
        require(
            IERC20M(asset).transferFrom(msg.sender, address(this), amount),
            "fund"
        );
    }

    function deposit(
        address asset,
        uint256 amount,
        uint256 duration,
        uint256 profitBps
    ) external returns (uint256 id, uint256 maturity) {
        require(
            IERC20M(asset).transferFrom(msg.sender, address(this), amount),
            "deposit"
        );
        id = nextId++;
        maturity = block.timestamp + duration;
        positions[id] = Position(
            asset,
            amount,
            (amount * profitBps) / 10_000,
            maturity,
            false
        );
    }

    function redeem(uint256 id) external {
        Position storage p = positions[id];
        require(!p.redeemed && block.timestamp >= p.maturity, "not mature");
        p.redeemed = true;
        require(
            IERC20M(p.asset).transfer(msg.sender, p.principal + p.profit),
            "redeem"
        );
    }

    /// @notice Fixes M6: explicit recipient, so the router always receives the funds.
    function emergencyRedeem(
        uint256 id,
        uint256 haircutBps,
        address recipient
    ) external {
        require(recipient != address(0), "recipient");
        Position storage p = positions[id];
        require(!p.redeemed && haircutBps <= 10_000, "invalid");
        p.redeemed = true;
        uint256 amount = p.principal - ((p.principal * haircutBps) / 10_000);
        require(IERC20M(p.asset).transfer(recipient, amount), "redeem");
    }
}
