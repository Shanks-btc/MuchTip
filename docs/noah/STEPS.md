# Porting MuchTip into Noah AI: steps (Route B)

The contract (`0x207652b0767F9f19d24B5300E2123D415167aCeF`) and the Supabase backend (`dogeOs`, functions `resolve`,
`sign-claim`, `feed`) stay exactly as they are. Only the frontend is rebuilt inside Noah, so the entry is "a link to your
application built using Noah AI" (hackathon rule). Background and sources: [../noah-research.md](../noah-research.md).

Each step says where it comes from: **[docs]** means it follows a Noah docs page; **[unverified]** means the docs don't
describe it and you should check what the UI shows.

**Deadline: 6 November 2026, 18:00 UTC** (the hackathon record's `endDate`).

## Before you start

1. **Plan.** The Code tab (needed to paste files from [FILES.md](FILES.md)) is "available on paid plans only" **[docs:
   features/code-editor]**. Starter is $10/month with 5M credits **[docs: plans-and-credits]**. Chat-only building works on
   Free.
2. Have **MetaMask** (or another EVM wallet) with test DOGE on Chikyū for the preview test, and the X account you will
   test claiming with.

## Build

3. **Create the project.** On trynoah.ai, start a new project, pick the chain **DogeOS** and the mode **Website**
   **[unverified: the DogeOS option exists in Noah's app code, `{id:"doge", name:"DogeOS", dappMode: WEB_APP}`, but no
   docs page shows it]**. If Noah asks for a first prompt to create the project, use the master prompt (step 5).
4. **Set the environment variables** from [ENV.md](ENV.md): gear icon → **Env. Variables** → **Add Variables** → paste
   the `KEY=VALUE` lines → **Save** **[docs: integrations/environment-variables]**. Leave `APP_ORIGIN` out for now.
5. **Send the master prompt.** Switch the chat to **Agent mode** and paste everything between the two rules in
   [MASTER_PROMPT.md](MASTER_PROMPT.md) **[docs: features/agent-mode]**.
6. **Do not click these**, because they would change what is already live:
   - **Cloud → Connect Supabase** (it would give Noah access to the `dogeOs` project and may rewrite its Auth redirect
     URLs **[docs: integrations/supabase/redirect-urls]**).
   - **Publish → Smart Contract**, or any "deploy contract" action in chat.
   - Any wallet SDK integration Noah offers (Privy and others).
7. **Make the code match the tested repository.** Open the **Code** tab **[docs: features/code-editor]** and, for each
   file in [FILES.md](FILES.md) **in the listed order**, open the file at that path and replace its content with the block
   from FILES.md. Start with the 10 configuration files (`package.json` first, so the exact dependency versions are used),
   then the 52 source files.
   - If the editor cannot create a file that doesn't exist yet **[unverified: the docs list browse, search, edit and copy
     only]**, ask in chat: "Create `<path>` with exactly this content:" followed by the block.
   - If Noah cannot install the packages from `package.json` **[unverified]**, ask in chat to install exactly the versions
     in the FILES.md table.
   - Check after the last file: the preview loads, and the browser console shows no errors.
8. **Test in the preview** **[docs: features/preview-debug]**: the landing feed shows "Live"; on `/app`, typing `kirahszn`
   shows "kirah · X ID 1739237750744707072 · Verified on X"; connecting the wallet works; the fee lines show numbers.
   The preview's address is a different origin, so `resolve`/`feed` calls from it may be blocked by CORS until you add that
   origin (step 11). That is expected.

## Publish

9. **Publish the web app**: **Publish** (top right) → **Web App** tab (not Smart Contract) → connect Netlify if asked
   (one-time) → **Deploy** → copy the **Published URL** **[docs: deploy-and-host/dapp-publish]**.
10. **Set `APP_ORIGIN`** to that URL in Env. Variables, then **Redeploy** **[docs: dapp-publish "Use Redeploy any time"]**.

## After the Netlify URL exists (replace `<site>` with yours)

11. **CORS on the Supabase functions.** Add the Netlify origin to the list (the functions accept a comma-separated list
    since commit `5b7d17d`). From the repo root:

    ```
    npx supabase secrets set --remote=pztyjrxfdieleucryskj "CORS_ALLOW_ORIGIN=https://muchtip.vercel.app,http://localhost:5173,https://<site>.netlify.app"
    ```

    If you want the Noah preview to call the backend too, add its origin as well (see it in the browser's address bar
    or the console's CORS error). Check with:

    ```
    curl -s -i -H "Origin: https://<site>.netlify.app" "https://pztyjrxfdieleucryskj.supabase.co/functions/v1/feed?limit=1" | grep -i access-control-allow-origin
    ```

    It must print `Access-Control-Allow-Origin: https://<site>.netlify.app`.
12. **Supabase Auth redirect allow list.** Supabase dashboard → Authentication → URL Configuration → Redirect URLs → add
    `https://<site>.netlify.app/app/claim`, keeping `https://muchtip.vercel.app/app/claim` and
    `http://localhost:5173/app/claim`. Leave the Site URL as `https://muchtip.vercel.app` (or set it to the Netlify URL
    if that becomes the main site). Without this entry, Sign in with X on the Netlify site lands on the Site URL instead
    of `/app/claim`.
13. **Test the published site**: lookup, wallet connect, Sign in with X returns to `/app/claim`, the feed is "Live".

## Submit

14. **Share** → make the project public and copy the link **[docs: features/code-editor "Share"]**.
15. On the hackathon page, **Participate Now**, choose the project and fill in name, description, DogeOS integration and
    screenshots or a short walkthrough **[docs: hackathon page "Submission Requirements"]**, before 6 Nov 2026 18:00 UTC.
    Only one project per hackathon.
