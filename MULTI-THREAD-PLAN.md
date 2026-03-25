# Multi-Thread Concurrent Streaming — Refactor Plan

## 1. Current Architecture Limitations

### Single-stream bottleneck in `useChatStore` (chat.ts)
- **`isStreaming: boolean`** — One global flag. If thread A is streaming, thread B cannot send.
- **`abortController: AbortController | null`** — One controller. Aborting kills whichever stream is active, with no thread affinity.
- **`messages: Message[]`** — Single flat array representing the "active" thread. Switching threads calls `loadThread()` which replaces the entire array and resets `isStreaming: false` + `abortController: null` — **killing any in-flight stream**.

### `useChat.ts` enforces single-stream
- Line 67: `if (store.isStreaming) return` — hard blocks sending if *any* thread is streaming.
- All callbacks (`appendToMessage`, `finalizeMessage`, etc.) operate on the single `messages` array. If the user switches threads mid-stream, tokens append to the wrong thread's messages (or a stale array).
- `abort()` aborts the single global controller — no way to abort thread A but not thread B.

### `App.tsx` — wiring is single-thread aware
- Line 58: `const { messages, isStreaming, send, abort } = useChat()` — one set of controls for the whole app.
- Line 448: `isStreaming={isStreaming && visiblePanel === activeThreadId}` — tries to scope the stop button, but `isStreaming` is still global.
- `handleSend` (line 311) must `switchThread` + `loadThread` before calling `send`, because `send` always operates on whatever's in the global `messages` array.

### `ChatViewPanel` — snapshot vs live
- Line 483: Active thread gets live `storeMessages`; inactive threads get a frozen `loadThreadMessages()` snapshot. If an inactive thread is streaming in the background, its panel won't update.

### Thread switching destroys stream state
- `loadThread()` (chat.ts:129) does `set({ messages, isStreaming: false, abortController: null })` — nukes any in-progress stream regardless of which thread it belongs to.

---

## 2. Proposed New Architecture

### Core idea: Per-thread state map

Replace the single `messages`/`isStreaming`/`abortController` with a `Map<threadId, ThreadStreamState>`.

```typescript
interface ThreadStreamState {
  messages: Message[]
  isStreaming: boolean
  abortController: AbortController | null
}

interface ChatState {
  // Per-thread state, keyed by threadId
  threadStates: Map<string, ThreadStreamState>

  // All actions now take threadId as first parameter
  addMessage: (threadId: string, msg: Omit<Message, 'id' | 'timestamp'>) => string
  appendToMessage: (threadId: string, id: string, token: string) => void
  appendThinking: (threadId: string, id: string, token: string) => void
  setThinkingDone: (threadId: string, id: string) => void
  finalizeMessage: (threadId: string, id: string) => void
  updateMessage: (threadId: string, id: string, content: string) => void
  setStreaming: (threadId: string, streaming: boolean) => void
  setAbortController: (threadId: string, controller: AbortController | null) => void
  clearMessages: (threadId: string) => void

  // Helpers
  getThreadState: (threadId: string) => ThreadStreamState
  ensureThread: (threadId: string) => void  // lazy-load from localStorage
  evictThread: (threadId: string) => void   // free memory for off-screen threads
}
```

### Selector hooks for components

```typescript
// Components subscribe to a specific thread's state
function useThreadMessages(threadId: string): Message[] {
  return useChatStore((s) => s.getThreadState(threadId).messages)
}

function useThreadStreaming(threadId: string): boolean {
  return useChatStore((s) => s.getThreadState(threadId).isStreaming)
}
```

### `useChat` becomes thread-scoped

```typescript
function useChat(threadId: string) {
  // send() targets threadId, not the global active thread
  // abort() aborts threadId's controller only
  // No global isStreaming guard — each thread is independent
}
```

Or alternatively, `send(threadId, content, images?)` and `abort(threadId)` as standalone functions (no hook needed — just store actions).

### Zustand Map serialization note

Zustand's `set()` uses shallow comparison. A `Map` reference must change for re-renders. Two approaches:

**Option A: Use a plain object `Record<string, ThreadStreamState>`.**
Simpler serialization, Zustand-friendly. Slightly less ergonomic but avoids Map gotchas.

**Option B: Use `Map` with immer middleware.**
Cleaner API but adds a dependency.

**Recommendation: Option A** — plain object. Keeps the store simple, no new deps.

```typescript
interface ChatState {
  threadStates: Record<string, ThreadStreamState>
  // ...
}
```

---

## 3. Migration Strategy

### Phase 1: Refactor store shape (chat.ts)
1. Replace `messages`, `isStreaming`, `abortController` with `threadStates: Record<string, ThreadStreamState>`.
2. All store actions take `threadId` as first parameter.
3. `getThreadState(threadId)` returns the entry or lazy-loads from localStorage.
4. Remove `loadThread()` entirely — no more "swap the active messages" pattern.
5. Saving to localStorage: each mutation that touches `messages` calls `saveThreadMessages(threadId, messages)` as before — the key is already per-thread.

### Phase 2: Refactor useChat.ts
1. `send(threadId, content, images?)` — targets a specific thread.
2. Remove the global `if (store.isStreaming) return` guard. Instead: `if (store.threadStates[threadId]?.isStreaming) return` — only blocks double-send on the *same* thread.
3. `abort(threadId)` — only aborts that thread's controller.
4. All callbacks pass `threadId` to store actions.
5. Retry logic scopes to the correct thread.
6. Title generation uses the correct threadId (already does, but verify).

### Phase 3: Refactor App.tsx
1. `ChatViewPanel` subscribes to `useThreadMessages(threadId)` and `useThreadStreaming(threadId)` — always live, never snapshot.
2. Remove `loadThread()` calls from `scrollToThread` and `handleSend`. Thread switching is now purely a UI concern (which panel is visible), not a data concern.
3. `InputBar` receives `isStreaming` scoped to the visible thread: `isStreaming={useThreadStreaming(visiblePanel)}`.
4. `onAbort` calls `abort(visiblePanel)` — only stops the visible thread.
5. `handleSend` sends to `visiblePanel`'s threadId (or creates a new thread and sends to that).

### Phase 4: Memory management
1. **Eager load** threads that are in the scroll-snap viewport (visible + adjacent).
2. **Evict** threads that are far off-screen and not streaming. Eviction = remove from `threadStates` (already persisted to localStorage).
3. **Never evict a streaming thread** — its in-flight tokens would be lost.
4. On scroll settle, ensure the newly visible thread is in `threadStates`.

---

## 4. Key Design Decisions

### Keep messages in memory per thread vs lazy-load?

**Decision: Hybrid.** All threads that are currently streaming MUST be in memory (tokens need somewhere to go). Visible + adjacent threads are kept in memory for instant swipe. Distant non-streaming threads are evicted to save RAM.

Rationale: With a 100-message cap per thread and typical 3-8 active threads, memory is fine. Only worth evicting if the user has 20+ threads. Start without eviction, add it later if needed.

**Simplification for v1: Keep all threads with messages in `threadStates`.** 100 messages × 10 threads × ~2KB per message = ~2MB. Totally fine. Add eviction only if profiling shows issues.

### How to handle abort per thread?

Each `ThreadStreamState` holds its own `AbortController`. `abort(threadId)` calls `threadStates[threadId].abortController?.abort()`. The stop button in `InputBar` calls `abort(visibleThreadId)`. Other threads' streams are unaffected.

### What happens when a user switches away from a streaming thread?

Nothing breaks. The stream's callbacks target `threadId` explicitly, so tokens keep appending to the correct thread's state. When the user swipes back, they see the accumulated content. The `ChatViewPanel` subscribes to that thread's messages reactively.

### What about the offline queue?

The offline queue in `useChat.ts` currently just stores content strings. It should also store the target `threadId` so messages replay to the correct thread on reconnect.

```typescript
offlineQueueRef.current.push({ threadId, content, images })
```

### What about `connectionStatus`?

Keep it global in `useUIStore`. Connection status is about the gateway, not individual threads. All threads share the same gateway.

---

## 5. Risk / Complexity Assessment

| Area | Risk | Complexity | Notes |
|------|------|-----------|-------|
| Store refactor (chat.ts) | Low | Medium | Mechanical: add threadId param to all actions, wrap in Record |
| useChat.ts refactor | Medium | Medium | Must carefully scope all callbacks. Retry logic needs threadId. |
| App.tsx wiring | Low | Low | Mostly removing `loadThread` calls, passing threadId to send/abort |
| ChatViewPanel | Low | Low | Switches from conditional snapshot to always-live subscription |
| Zustand re-render perf | Medium | Low | Need per-thread selectors to avoid all panels re-rendering on any thread's token |
| iOS scroll-snap interaction | Low | None | No changes to scroll-snap logic — it's purely UI |
| localStorage persistence | Low | Low | Already per-thread keyed — no changes needed |
| Server sync | Low | Low | Already per-thread — no changes needed |
| TTS integration | Low | Low | Already message-ID scoped, not thread-scoped |

### Biggest risk: Zustand selector performance

When thread A receives a token, `threadStates` reference changes. Without careful selectors, ALL `ChatViewPanel` components re-render.

**Mitigation:** Use shallow equality selectors:
```typescript
const messages = useChatStore(
  (s) => s.threadStates[threadId]?.messages ?? [],
  shallow  // only re-render if this specific thread's messages changed
)
```

Or use Zustand's `useShallow` from `zustand/react/shallow`.

Actually, since we're using a `Record`, the top-level reference changes on every update. Better approach: **use `subscribeWithSelector` middleware** or structure the store so each thread's state is a separate nested reference that only changes when that thread is mutated.

**Concrete approach:** When mutating thread A's messages, only replace `threadStates[threadA]`, not the others:

```typescript
set((state) => ({
  threadStates: {
    ...state.threadStates,
    [threadId]: {
      ...state.threadStates[threadId],
      messages: newMessages,
    },
  },
}))
```

With a selector like `(s) => s.threadStates[threadId]?.messages`, Zustand's default reference equality means only the panel for `threadId` re-renders. The spread creates a new top-level `threadStates` object, but each other thread's value is the same reference — so selectors for other threads return the same reference and skip re-render. This should work without any middleware.

---

## 6. Implementation Steps

### Step 1: Refactor `chat.ts` store shape
- Replace `messages`, `isStreaming`, `abortController` with `threadStates: Record<string, ThreadStreamState>`.
- Add `getThreadState(threadId)` that lazy-loads from localStorage if not in memory.
- Rewrite all actions to take `threadId` and operate on `threadStates[threadId]`.
- Remove `loadThread()`.
- Keep `saveMessages` / `saveThreadMessages` calls in the same places.
- **Test:** Store unit behavior — add message to thread A, verify thread B unaffected.

### Step 2: Refactor `useChat.ts`
- `send(threadId, content, images?)` — thread-scoped.
- `abort(threadId)` — thread-scoped.
- Remove global `isStreaming` guard, add per-thread guard.
- All SSE callbacks pass threadId to store actions.
- Update offline queue to include threadId.
- **Test:** Can send to thread A while thread B is streaming.

### Step 3: Refactor `App.tsx` wiring
- Remove all `loadThread()` calls from `scrollToThread`, `handleSend`, etc.
- `handleSend` passes `visiblePanel` (or new thread ID) directly to `send(threadId, ...)`.
- `InputBar` gets `isStreaming` from `useThreadStreaming(visiblePanel)`.
- `onAbort` calls `abort(visiblePanel)`.
- **Test:** Send in thread A, swipe to thread B, send there too. Both stream. Swipe back — thread A shows its accumulated response.

### Step 4: Refactor `ChatViewPanel`
- Subscribe to `useChatStore((s) => s.threadStates[threadId]?.messages ?? [])`.
- Remove the `threadId === activeThreadId ? storeMessages : loadThreadMessages()` branch.
- Every panel is now always live.
- **Test:** Background thread's streaming content appears when swiping to it.

### Step 5: Update `InputBar` stop button
- Already receives `isStreaming` as prop — just need to ensure it's per-thread.
- Verify stop button only shows for the thread that's actually streaming.
- **Test:** Thread A streaming, swipe to idle thread B — no stop button. Swipe back to A — stop button visible.

### Step 6: Clean up threads.ts
- Remove `switchThread` side effects that depend on chat store (there are none currently — `switchThread` just updates `activeThreadId`).
- `activeThreadId` becomes purely a UI concept for "last viewed thread" (used by title pill, server sync user field, etc.).

### Step 7: Performance validation
- Verify that streaming tokens in thread A don't cause re-renders in thread B's panel.
- Profile with React DevTools / Profiler.
- Add `shallow` equality to selectors if needed.

### Step 8: Edge cases
- Deleting a thread that's currently streaming: abort its stream first, then remove from `threadStates`.
- Creating a new thread from home screen: create in `threadStates`, send immediately.
- App backgrounding (mobile): streams may die — existing retry logic handles this, just ensure it retries to the correct `threadId`.
- Server sync on startup: load thread messages into `threadStates` for any thread that doesn't already have an entry.

---

## Appendix: Files Changed

| File | Change Type | Scope |
|------|------------|-------|
| `src/state/chat.ts` | **Major rewrite** | New store shape, all actions thread-scoped |
| `src/hooks/useChat.ts` | **Major rewrite** | Thread-scoped send/abort, remove global guard |
| `src/App.tsx` | **Medium refactor** | Remove loadThread calls, pass threadId to send/abort |
| `src/components/chat/InputBar.tsx` | **Minor** | No structural changes — props already correct |
| `src/components/chat/ChatView.tsx` | **Minor** | May need to accept threadId for scroll cache key |
| `src/state/threads.ts` | **Minor** | Remove any chat store coupling from switchThread |
