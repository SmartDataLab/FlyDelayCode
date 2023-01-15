import { BigNumber, Contract } from 'ethers'
import { useActiveWeb3React } from './'
import { calculateGasMargin, getContract } from 'utils'
import deployments from '../constants/deployments.json'
import { useMemo } from 'react'
import { useTransactionAdder } from 'state/transactions/hooks'
import { defaultAbiCoder, formatEther, parseUnits } from 'ethers/lib/utils'
import { useSingleCallResult } from 'state/multicall/hooks'
import isZero from 'utils/isZero'

const { address, abi } = deployments.Staking

export interface Stake {
  isStake: boolean
  dipAmount: string
  daiAmount: string
}

export enum StakeCallbackState {
  INVALID,
  LOADING,
  VALID
}

interface StakeParameters {
  /**
   * The method to call on the Uniswap V2 Router.
   */
  methodName: string
  /**
   * The arguments to pass to the method, all hex encoded.
   */
  args: string[]
  /**
   * The amount of wei to send in hex.
   */
  value?: string
}

interface StakeCall {
  contract: Contract
  parameters: StakeParameters
}

interface SuccessfulCall {
  call: StakeCall
  gasEstimate: BigNumber
}

interface FailedCall {
  call: StakeCall
  error: Error
}

type EstimatedStakeCall = SuccessfulCall | FailedCall

const toWei = (arg: string) => parseUnits(arg).toHexString()

function useStakeCallArguments(stake: Stake): StakeCall | null {
  const { isStake = true, daiAmount, dipAmount } = stake
  const { account, library } = useActiveWeb3React()

  return useMemo(() => {
    const parameters = {
      methodName: isStake ? 'stake' : 'unstake',
      args: [isStake ? toWei(dipAmount) : toWei(daiAmount)],
      value: isStake ? toWei(daiAmount) : undefined
    }

    if (!library || !account) return null
    const contract: Contract = getContract(address, abi, library, account)
    if (!contract) {
      return null
    }

    return { contract, parameters }
  }, [account, isStake, daiAmount, dipAmount, library])
}

// returns a function that will stake, if the parameters are all valid
// and the user has approved the slippage adjusted input amount for the stake
export function useStakeCallback(
  dipAmount: string,
  daiAmount: string
): {
  state: StakeCallbackState
  callback: null | (() => Promise<string>)
  error: string | null
} {
  const { account, chainId, library } = useActiveWeb3React()

  const stakeCall = useStakeCallArguments({ isStake: true, dipAmount, daiAmount })
  const addTransaction = useTransactionAdder()

  return useMemo(() => {
    if (!stakeCall || !library || !account || !chainId) {
      return { state: StakeCallbackState.INVALID, callback: null, error: 'Missing dependencies' }
    }

    return {
      state: StakeCallbackState.VALID,
      callback: async function onStake(): Promise<string> {
        const {
          contract,
          parameters: { methodName, args, value }
        } = stakeCall

        const options = !value || isZero(value) ? {} : { value }

        console.log('args', args, options)

        const estimatedStakeCall: EstimatedStakeCall = await contract.estimateGas[methodName](...args, options)
          .then(gasEstimate => {
            return {
              call: stakeCall,
              gasEstimate
            }
          })
          .catch(gasError => {
            console.debug('Gas estimate failed, trying eth_call to extract error', stakeCall)

            return contract.callStatic[methodName](...args, options)
              .then(result => {
                console.debug('Unexpected successful call after failed estimate gas', stakeCall, gasError, result)
                return {
                  call: stakeCall,
                  error: new Error('Unexpected issue with estimating the gas. Please try again.')
                }
              })
              .catch(callError => {
                console.debug('Call threw error', stakeCall, callError)
                const reason = callError.reason
                  ? callError.reason
                  : callError.code
                  ? callError.data.data.slice(0, 8) === 'Reverted'
                    ? `Error: Revert; Reason: ${
                        defaultAbiCoder.decode(['string'], '0x' + callError.data.data.slice(19))[0]
                      }; Message = ${callError.data.message}`
                    : `Error: Code = ${callError.code}, data = ${JSON.stringify(callError.data)}`
                  : JSON.stringify(callError)
                return { call: stakeCall, error: new Error(reason) }
              })
          })

        if ('error' in estimatedStakeCall) {
          console.debug('Error in estimateStakeCall, error=', estimatedStakeCall.error)
          throw estimatedStakeCall.error
        }

        // now everything is prepared, execute the call
        return contract[methodName](...args, {
          gasLimit: calculateGasMargin(estimatedStakeCall.gasEstimate),
          from: account,
          value
        })
          .then((response: any) => {
            const summary = `Staked ${daiAmount}/${dipAmount}`
            addTransaction(response, {
              summary
            })

            return response.hash
          })
          .catch((error: any) => {
            console.error('errror', error)
            // if the user rejected the tx, pass this along
            if (error?.code === 4001) {
              throw new Error('Transaction rejected.')
            } else {
              // otherwise, the error was unexpected and we need to convey that
              console.error(`Stake failed`, error, methodName, args)
              throw new Error(`Stake failed: ${error.message}`)
            }
          })
      },
      error: null
    }
  }, [daiAmount, dipAmount, stakeCall, library, account, chainId, addTransaction])
}

export function useWithdrawCallback(
  daiAmount: string
): {
  state: StakeCallbackState
  callback: null | (() => Promise<string>)
  error: string | null
} {
  const { account, chainId, library } = useActiveWeb3React()

  const withdrawCall = useStakeCallArguments({ isStake: false, daiAmount, dipAmount: '' })
  const addTransaction = useTransactionAdder()

  return useMemo(() => {
    if (!withdrawCall || !library || !account || !chainId) {
      return { state: StakeCallbackState.INVALID, callback: null, error: 'Missing dependencies' }
    }

    return {
      state: StakeCallbackState.VALID,
      callback: async function onStake(): Promise<string> {
        const {
          contract,
          parameters: { methodName, args }
        } = withdrawCall

        const estimatedWithdrawCall: EstimatedStakeCall = await contract.estimateGas[methodName](...args)
          .then(gasEstimate => {
            return {
              call: withdrawCall,
              gasEstimate
            }
          })
          .catch(gasError => {
            console.debug('Gas estimate failed, trying eth_call to extract error', withdrawCall)

            return contract.callStatic[methodName](...args)
              .then(result => {
                console.debug('Unexpected successful call after failed estimate gas', withdrawCall, gasError, result)
                return {
                  call: withdrawCall,
                  error: new Error('Unexpected issue with estimating the gas. Please try again.')
                }
              })
              .catch(callError => {
                console.debug('Call threw error', withdrawCall, callError)
                const reason = callError.reason
                  ? callError.reason
                  : callError.code
                  ? callError.data.data.slice(0, 8) === 'Reverted'
                    ? `Error: Revert; Reason: ${
                        defaultAbiCoder.decode(['string'], '0x' + callError.data.data.slice(19))[0]
                      }; Message = ${callError.data.message}`
                    : `Error: Code = ${callError.code}, data = ${JSON.stringify(callError.data)}`
                  : JSON.stringify(callError)
                return { call: withdrawCall, error: new Error(reason) }
              })
          })

        if ('error' in estimatedWithdrawCall) {
          console.debug('Error in estimatedWithdrawCall, error=', estimatedWithdrawCall.error)
          throw estimatedWithdrawCall.error
        }

        // now everything is prepared, execute the call
        return contract[methodName](...args, {
          gasLimit: calculateGasMargin(estimatedWithdrawCall.gasEstimate),
          from: account
        })
          .then((response: any) => {
            const summary = `Withdrawn ${daiAmount}`
            addTransaction(response, {
              summary
            })

            return response.hash
          })
          .catch((error: any) => {
            console.error('errror', error)
            // if the user rejected the tx, pass this along
            if (error?.code === 4001) {
              throw new Error('Transaction rejected.')
            } else {
              // otherwise, the error was unexpected and we need to convey that
              console.error(`Withdraw failed`, error, methodName, args)
              throw new Error(`Withdraw failed: ${error.message}`)
            }
          })
      },
      error: null
    }
  }, [daiAmount, withdrawCall, library, account, chainId, addTransaction])
}

export function useStakeBalance() {
  const { account, library } = useActiveWeb3React()

  const contract: Contract | null = library && account ? getContract(address, abi, library, account) : null
  const { result } = useSingleCallResult(contract, 'getStake', [account ?? undefined])

  return useMemo(() => {
    if (result) {
      const [stableBalance, dipBalance] = result
      return [formatEther(stableBalance), formatEther(dipBalance)]
    } else {
      return []
    }
  }, [result])
}

export function useRequiredDip(daiAmount: string) {
  const { account, library } = useActiveWeb3React()

  const contract: Contract | null = library && account ? getContract(address, abi, library, account) : null
  const { result } = useSingleCallResult(contract, 'calculateRequiredDip', [toWei(daiAmount)])

  return useMemo(() => {
    const data = result?.[0]
    if (data) {
      return formatEther(data)
    } else {
      return daiAmount
    }
  }, [result, daiAmount])
}

export function useDaiAmountLocked() {
  const { account, library } = useActiveWeb3React()

  const contract: Contract | null = library && account ? getContract(address, abi, library, account) : null
  const { result } = useSingleCallResult(contract, 'getLockedStakeFor', [account ?? undefined])

  return useMemo(() => {
    const data = result?.[0]
    if (data) {
      return formatEther(data)
    } else {
      return '0'
    }
  }, [result])
}

export function useUnprocessedUnStakeRequest() {
  const { account, library } = useActiveWeb3React()

  const contract: Contract | null = library && account ? getContract(address, abi, library, account) : null
  const { result } = useSingleCallResult(contract, 'lastUnprocessedUnstakeRequest')

  return useMemo(() => {
    const data = result?.[0]
    if (data) {
      return formatEther(data)
    } else {
      return '0'
    }
  }, [result])
}
