# MuchTip privacy policy

Last updated: 3 November 2026

MuchTip lets you tip an X account in DOGE through a smart contract on the **DogeOS Chikyū testnet**. It is a test
deployment: test DOGE has no value. This page says what MuchTip stores and why.

## What is public on the blockchain

Everything a tip does on chain is public and permanent, and nobody (including us) can delete it:

- the sending wallet address, the amount and the time of every tip;
- the receiving X account as a hash of its numeric X user id, and, when a tip is claimed, the numeric X user id itself
  and the wallet address it was paid to;
- refunds, with the refunding wallet address.

Our server keeps a copy of these contract events to show the activity feed. It is the same public data.

## What our server stores

MuchTip runs on Supabase. It stores:

- **When you sign in with X:** the account details X shares with Supabase Auth at sign-in (your X user id, handle,
  display name and profile picture link). We use them only to prove which X account you control so the contract can
  pay that account's tips to the wallet you choose. Your session is kept in your browser until you sign out.
- **When anyone looks up a handle:** the public X user id, handle and display name for that handle, with the time of
  the lookup, so a handle maps to the right account. This is public profile data from X's API.
- **Rate limits:** counters keyed by a shortened SHA-256 hash of your IP address. We do not store IP addresses.
- **Service logs:** short records of events such as "handle looked up" or "claim signed", which can include an X handle
  or X user id. They never include IP addresses, sign-in tokens or keys.

## What stays in your browser

- The note you write on a tip. It is never sent to our server; it only appears on your receipt and in a post if you
  choose to share one.
- The handles of accounts you tipped (so My tips can show names) and whether you hid the setup panel.

## What we never do

- We never sell or share your data for advertising.
- We never post on X or send messages for you. Sign-in only reads your account's identity.
- We never hold your DOGE or your wallet keys.

## Services we use

Supabase (database, sign-in and server functions), the X API (handle lookups and sign-in), the DogeOS RPC (reading the
blockchain), Vercel (hosting the website) and whichever wallet you connect. Each has its own privacy policy.

## Your choices

Sign out at any time from the Claim page. To ask us to delete the sign-in record or cached lookups linked to your X
account, open an issue on GitHub. On-chain records cannot be deleted by anyone.

## Contact

Open an issue at https://github.com/Shanks-btc/MuchTip/issues.
