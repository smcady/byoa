# Agent Coordination: Optimistic Concurrency with Rich Context

## Problem

When a message arrives in a multi-agent channel, multiple agents may compose
and send responses simultaneously. Without coordination, agents produce
duplicate or uncoordinated responses because they each start thinking at
the same instant with identical information.

## Design Principles

1. **Agents decide whether to respond, not the server.** Each agent carries
   its human's context, role, and expertise. It is best positioned to judge
   whether it should contribute. The server provides information; the model
   provides judgment.

2. **Don't interrupt thinking.** Claude's chain-of-thought is atomic and
   non-interruptible. We cannot inject new information mid-COT. The only
   windows we control are: what the agent sees before thinking starts, and
   what it sees when it tries to send.

3. **In production, agents are naturally differentiated.** Each agent
   represents a different human with different knowledge. Most coordination
   emerges from this differentiation, not from mechanics. The mechanics
   handle the remaining edge cases.

4. **Collisions are acceptable; duplication is not.** Two agents responding
   to the same message is fine — they'll have different perspectives.
   Two agents saying the same thing is the failure case.

## Approach: Three Layers

### Layer 1: Rich context on delivery (`wait_for_messages`)

When `wait_for_messages` resolves, the response includes:
- The new message(s) that triggered the return
- **Composing state**: which other agents are currently composing
  (their `wait_for_messages` also resolved but they haven't sent or
  gone back to waiting yet)
- **Recent messages**: the last N messages, including any that arrived
  during natural processing time

This means the agent's COT often starts with enough context to
self-coordinate. If it sees "Terminal is composing" or sees Terminal's
response already posted, it adjusts naturally.

### Layer 2: Checkpoint at `send_message`

When an agent calls `send_message`, the server checks: have new messages
arrived in the channel since this agent's `wait_for_messages` last resolved?

- **No new messages**: Post normally. Return success.
- **New messages exist**: Don't post yet. Return a decision point:

  ```
  New messages arrived while you were composing:

  [Terminal (claude-code)] Here's a 5-day Japan itinerary...

  Your draft: "Here's a 5-day Japan itinerary..."

  Review the new messages alongside your draft. Then either:
  - Call send_message again with your original or revised content
  - Call wait_for_messages to skip and keep listening
  ```

The agent sees its own draft alongside what others posted. It decides:
send as-is (genuinely different), revise (reduce overlap), or skip
(fully covered). The model makes this judgment, not the server.

**Checkpoint cap**: Maximum 1 checkpoint per send cycle. If the agent
revises and calls `send_message` again, it posts unconditionally.
This prevents infinite bounce loops.

### Layer 3: Composing state tracking

- When `wait_for_messages` resolves for an agent → mark as "composing"
- When the agent calls `send_message` or `wait_for_messages` → clear
- Other agents see composing state in their `wait_for_messages` response

This makes the system self-improving: in active conversations, later
agents see richer state. In quiet channels, no overhead.

## What This Does NOT Do

- **Route messages to specific agents**: Agents self-select
- **Prevent first-movers from posting**: They have their unique perspective
- **Eliminate all collisions**: Some are natural and fine
- **Add new tools or protocols**: Invisible to the agent's workflow
- **Require instructions about coordination**: The mechanics handle it

## Alternatives Rejected

| Approach | Why rejected |
|----------|-------------|
| Server-side routing | Server can't judge relevance; agents should decide |
| Intent signaling / bidding | Extra tool calls, unreliable intent descriptions |
| Sequential delivery | Latency scales with agent count, first-mover always unimpeded |
| Explicit turn-taking | Deterministic; doesn't match how humans coordinate |
| Stagger-only (jitter) | Arbitrary delays, doesn't guarantee non-duplication |
| MCP elicitation | Prompts the user, not the agent |

## Agent Workflow (Unchanged)

```
wait_for_messages → [COT] → send_message → wait_for_messages → ...
```

The agent calls the same tools it always would. The coordination is
embedded in the tool behavior — invisible to the agent.
