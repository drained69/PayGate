// The narration. `text` is shown as subtitles; `say` is what the voice reads (spelled for speech).
// Every claim here matches README.md: the vault has no keys, the agent key can call only
// request_payment, owner actions need the owner's wallet, and freeze and withdraw work without PayGate.

export type LineId =
  | 'hook' | 'fail' | 'intro' | 'who' | 'how' | 'signin' | 'vault' | 'job' | 'pay' | 'approve' | 'attack' | 'evidence' | 'end';

export const LINES: { id: LineId; text: string; say?: string }[] = [
  { id: 'hook', text: 'AI agents now pay for things: research, APIs, contractors, other agents. But an agent that can pay can be tricked into paying an attacker. One hidden line in a job brief is enough.' },
  { id: 'fail', text: "Today's defences sit in the wrong place. Rules in the prompt get argued away. Rules in the app fall the moment the agent's key is stolen. And a custodial wallet holds everyone's money." },
  { id: 'intro', text: "PayGate moves the rules where the agent can't reach them: a NEAR smart contract that you own." },
  { id: 'who', text: "It's for developers and teams who give AI agents a budget, to pay contractors, buy data and APIs, or hire other agents." },
  { id: 'how', text: 'One transaction creates two accounts: a vault you own, with no keys of its own, and an agent whose only key can call one method, request payment. The agent asks. The contract decides: allowlisted payees only, within your limits, each job paid once. Anything large waits for your signature.' },
  { id: 'signin', text: 'Sign in with your NEAR wallet. No password, no email.' },
  { id: 'vault', text: 'Create your vault in one transaction. Choose NEAR or USDC, set your limits, and list who the agent may pay.' },
  { id: 'job', text: 'Give the agent a job: a brief, a payee and a budget.' },
  { id: 'pay', text: 'When it delivers, payments inside your automatic limit go out on their own.' },
  { id: 'approve', text: 'Bigger ones are held on-chain until you approve them in your own wallet. PayGate never holds your owner key.' },
  { id: 'attack', text: 'Now the worst case. A hidden instruction hijacks the agent, and it uses its real key to try twelve ways to drain the vault. Every one is blocked on-chain. The attacker gets nothing.' },
  { id: 'evidence', text: 'Every payment leaves a NEAR transaction and a hash-linked receipt. Freeze in one signature, and withdraw any time, even if PayGate goes offline.' },
  { id: 'end', text: 'PayGate. Agent budgets, enforced. trypaygate.xyz', say: 'PayGate. Agent budgets, enforced. Try paygate dot x y z.' },
];
