---
'@gemstack/ai-sdk': patch
---

fix(ai-sdk): a store whose unscoped `list()` hides other users' threads no longer fails open on resume-by-id

The #984 owner check settles ownership from `ConversationStoreListEntry.userId`, falling back to an unscoped `store.list()` when the caller's scoped listing does not hold the thread. A thread missing from that unscoped listing was read as "no owner recorded" and allowed, which is right for a pre-#984 ownerless row but wrong for a store whose `list()` with no user id returns nothing. Such a store implements `list(userId)` correctly and is fully owner-aware, and a cross-user resume was still allowed.

The unscoped listing reporting nothing at all, while the store demonstrably holds rows (the caller has threads of their own, or the target thread has messages), now proves the listing is not enumerating the backend, and the resume is refused with `ConversationOwnershipError`.

Deliberately unchanged: a listing that reports rows but not this one stays permissive, since an absent thread and a partial listing are indistinguishable there. Ownerless legacy threads on a store that enumerates normally stay resumable, with or without a user on the run, and a store that omits `userId` from its entries keeps its old permissive behavior.

`ConversationStore` gains no members. The listing contract the check depends on is now documented on the interface itself, where an implementer sees it, rather than only on the entry type's `userId` field.
