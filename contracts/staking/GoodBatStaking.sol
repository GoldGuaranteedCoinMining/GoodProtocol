// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;
import "./SimpleStaking.sol";
import "../Interfaces.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit BAT
 * or withdraw their stake in BAT
 * the contracts buy cBat and can transfer the daily interest to the  DAO
 */
contract GoodBatStaking is SimpleStaking {
	/**
	 * @param _token Token to swap DEFI token
	 * @param _iToken DEFI token address
	 * @param _ns Address of the NameService
	 * @param _tokenName Name of the staking token which will be provided to staker for their staking share
	 * @param _tokenSymbol Symbol of the staking token which will be provided to staker for their staking share
	 * @param _tokenSymbol Determines blocks to pass for 1x Multiplier
	 */
	constructor(
		address _token,
		address _iToken,
		uint256 _blockInterval,
		NameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol,
		uint64 _maxRewardThreshold
	)
		SimpleStaking(
			_token,
			_iToken,
			_blockInterval,
			_ns,
			_tokenName,
			_tokenSymbol,
			_maxRewardThreshold
		)
	{}

	/**
	 * @dev stake some BAT
	 * @param _amount of BAT to stake
	 */
	function mintInterestToken(uint256 _amount) internal override {
		cERC20 cToken = cERC20(address(iToken));
		uint256 res = cToken.mint(_amount);

		if (
			res > 0
		) //cDAI returns >0 if error happened while minting. make sure no errors, if error return DAI funds
		{
			require(res == 0, "Minting cBat failed, funds returned");
		}
	}

	/**
	 * @dev redeem BAT from compound
	 * @param _amount of BAT to redeem
	 */
	function redeem(uint256 _amount) internal override {
		cERC20 cToken = cERC20(address(iToken));
		require(cToken.redeemUnderlying(_amount) == 0, "Failed to redeem cBat");
	}

	function redeemUnderlying(uint256 _amount)
		internal
		override
		returns (address, uint256)
	{
		uint256 tokenBalance = token.balanceOf(address(this));
		cERC20 cToken = cERC20(address(iToken));
		require(cToken.redeem(_amount) == 0, "Failed to redeem cBat");
		uint256 redeemedAmount = token.balanceOf(address(this)) - tokenBalance;
		address[] memory path = new address[](2);
		path[0] = address(token);
		path[1] = nameService.getAddress("DAI");
		Uniswap uniswapContract =
			Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
		token.approve(address(uniswapContract), redeemedAmount);
		uint256[] memory swap =
			uniswapContract.swapExactTokensForTokens(
				redeemedAmount,
				0,
				path,
				nameService.getAddress("RESERVE"),
				block.timestamp
			);

		uint256 dai = swap[1];
		require(dai > 0, "token selling failed");
		return (address(token), redeemedAmount);
	}

	/**
	 * @dev returns Bat to cBat Exchange rate.
	 */
	function exchangeRate() internal view override returns (uint256) {
		cERC20 cToken = cERC20(address(iToken));
		return cToken.exchangeRateStored();
	}

	/**
	 * @dev returns decimals of token.
	 */
	function tokenDecimal() internal view override returns (uint256) {
		ERC20 token = ERC20(address(token));
		return uint256(token.decimals());
	}

	/**
	 * @dev returns decimals of interest token.
	 */
	function iTokenDecimal() internal view override returns (uint256) {
		ERC20 cToken = ERC20(address(iToken));
		return uint256(cToken.decimals());
	}

	function getGasCostForInterestTransfer()
		external
		view
		override
		returns (uint256)
	{
		return uint256(67917);
	}
}