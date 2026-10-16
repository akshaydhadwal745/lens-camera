# Sharing with consent (2026-10-12)

Photos and videos are shared between Lens identities (phone app and web app,
same screens). Before this design a share landed in the recipient's Shared tab
at once. Now every share is a **request the recipient accepts first**, and the
sender can take it back.

## Gaps this closes

| Gap (before) | Now |
|---|---|
| No consent: anything from anyone appeared in your library | Request → Accept / Decline / Block; nothing is reachable before Accept |
| 2-letter prefix search listed up to 20 look-alike random names; no confirmation | 3+ letters, exact name first, badges (signed-in account / guest phone, shared before), **scan the friend's "My Lens code"**, and a confirm sheet before sending |
| The sender couldn't undo a wrong share (only delete the photo for everyone) | **Cancel** while waiting, **Revoke** after acceptance (access ends at once) |
| Strangers became "recent contacts" on both sides just by sending | Contacts form only after an accept |
| Search had no rate limit (name scraping) | 300 searches/hour per identity; 2-letter queries return nothing |
| No statuses, expiry or block | pending → accepted / declined / cancelled / expired (7 days); accepted → revoked; block per sender |

## Statuses

```
pending ──accept──▶ accepted ──sender revokes──▶ revoked
   ├──decline (optionally + block)──▶ declined
   ├──sender cancels──▶ cancelled
   └──7 days──▶ expired
```

- **Always accept from this person** (chosen on Accept, per sender): their next
  shares arrive already accepted. Off again with `PUT /contacts/:id {trusted:false}`
  or by blocking.
- **Blocked** senders: their new shares never reach the inbox. The sender only
  sees "Waiting", then "Expired" (a block isn't revealed).
- Shares made before this design count as accepted (their access records exist).

## Security model

Every file link and video stream is given out only if an access record
`D#<recipient> S#<mediaId>#<ownerId>` exists (unchanged: `GET /shared`,
`stream.ts`). **That record is now written only on accept** (or auto-accept for
a trusted sender) and deleted on revoke. A pending request therefore gives:

- no original, no 2048 px preview, no stream;
- small thumbnails only, and only when the sender is someone the recipient
  accepted from before **or** the recipient asks (`?previews=1`, "Show
  previews"): protection against unwanted images from strangers.

## Data (DynamoDB, existing table)

| Item | Meaning |
|---|---|
| `D#<recipient>` `IN#<shareId>` | the request in the recipient's inbox |
| `D#<sender>` `OUT#<shareId>` | the same request in the sender's Sent list (kept even when the recipient blocked the sender) |
| `D#<recipient>` `S#<mediaId>#<owner>` | access record (accepted only), carries `shareId` |
| `D#<a>` `C#<b>` | contact after an accept; `trusted` = always accept |
| `D#<recipient>` `B#<sender>` | blocked |

Both copies of a request change status in one transaction, conditional on the
current status (and on not being expired for accept/decline/cancel).

## API (all need the normal session; `infra/lambda/api/shares.ts`)

| Route | |
|---|---|
| `POST /shares {mediaIds,to}` | one request per recipient → `requests: [{id,name,shareId,status}]` (`shared`/`recipients` kept for older apps) |
| `GET /shares/in` | inbox, newest first, `pending` count; thumbs only from known senders |
| `GET /shares/in/:id[?previews=1]` | one request; thumbnails on demand |
| `POST /shares/in/:id/accept {alwaysAccept?}` | → access records + contacts |
| `POST /shares/in/:id/decline {block?}` | |
| `GET /shares/out` | Sent, with each person's status |
| `POST /shares/out/:id/cancel` | pending → cancelled, accepted → revoked |
| `POST`/`DELETE /blocks/:userId`, `PUT /contacts/:userId {trusted}` | |
| `GET /users?q=` | 3+ letters, exact first, `account`, `sharedBefore`, `exact`; rate-limited |
| `GET /users/:id` | the person in a scanned "My Lens code" |

Account deletion removes the account's requests from other people's inbox/Sent.

## Screens (phone + web)

- **Send** (`src/app/share.tsx`): recent contacts, exact-name search, Scan code
  (phone), confirm sheet "Share N items with …" → result says who must accept.
- **Shared tab** (`SharesStrip`): "X wants to share with you · Review", links to
  Requests and Sent.
- **Requests / Sent** (`SharesList`, `/shares`, `/shares/sent`): statuses, Cancel / Revoke.
- **Review** (`/shares/[id]`): sender facts, thumbnails or "Show previews",
  Always accept, Accept / Decline / Decline and block.
- **Settings → Sharing**: My Lens code (QR of `https://<site>/u/<id>`), Requests and sent.

## Tests

`infra/scripts/e2e.sh` "search + share requests": pending gives no access,
previews are thumbnails only, cancel, accept, revoke, always-accept, expiry,
decline + block, unblock; account deletion with an accepted share.

## Later

"Leave" a contact.

Done 2026-10-16: **Blocked people** (Settings → Sharing; `GET /v1/blocks`,
Unblock asks first) and **`/u/<id>`** (a "My Lens code" scanned with the phone's
own camera: App Link → `src/app/u/[id].tsx` shows the person → pick photos →
share screen with them chosen; without Lens, `site/src/pages/u/` offers Open in
Lens / Get the app).
