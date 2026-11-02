# Demo post draft

Edit before posting. Replace the repository link with your own.

> What happens when someone tricks your AI agent into sending them your money?
>
> With Nocturne, nothing. Built at NEAR HACKATHON.
>
> I hijacked my own agent with a prompt injection and let it try 12 ways to steal the funds. A NEAR smart contract and a restricted access key stopped every one. The attacker got 0 NEAR.
>
> The rules live on-chain, where the agent can't rewrite them. NEAR AI Cloud runs the work, and NEAR Intents prices the payout. It runs on test NEAR today.
>
> Repo: <your public repository link>
>
> What limit would you need before trusting an agent with a budget?
>
> @NEARProtocol #NEARHackathon

## Video plan (under 90 seconds)

1. Show the injected brief, then run `npm run demo:attack` and let the `BLOCKED` lines scroll.
2. Pause on the final line: the attacker received 0 NEAR.
3. Switch to the app with `npm run dev:chain`. Approve a job and show the on-chain receipt.
4. Open Controls, show the contract's limits, and freeze the vault.
5. Close on the Evidence room's enclave report check.

Say on camera that payments use test NEAR. For a real delivery in step 3, set `NEAR_AI_API_KEY`, or the delivery will be a labelled sample.
