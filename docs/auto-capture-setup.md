# Auto-logging Apple Pay payments

Once set up, every Apple Pay tap is logged by itself and the bot messages you
what it saved. Setup is done once and takes about five minutes.

## 1. Get your key

Send `/autolog` to the bot. It replies with:

- a **URL** ending in `/ingest`
- a **key** starting with `sa_`

The key is shown once. Treat it like a password: anyone holding it can add
expenses to your account (nothing else). Sending `/autolog` again makes a new
key and the old one stops working straight away.

## 2. Test from your Mac first

Replace the URL and key with yours:

```sh
curl -i -X POST "https://<your-bot-host>/ingest" \
  -H "Authorization: Bearer sa_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"source":"wallet","text":"S$8.50 Ya Kun Kaya Toast","card":"Revolut"}'
```

You should see `HTTP/1.1 202` and, a few seconds later, a Telegram message:

```
⚡ Auto-logged  S$8.50  Ya Kun Kaya Toast
Food / Cafe · Apple Pay (Revolut) · 13/11/2026
[ ✏️ Edit ]  [ 🗑 Delete ]
```

Tap **Delete** to remove the test entry.

## 3. Create the automation on your iPhone

1. Open **Shortcuts** → **Automation** tab → **+** → **Transaction**.
2. **Card:** tick every card you pay with. Leave all categories selected.
3. Choose **Run Immediately** and turn **Notify When Run** off.
4. Tap **Next** → **New Blank Automation** → add the action
   **Get Contents of URL**.
5. Set **URL** to the URL from `/autolog`.
6. Expand the action and set:
   - **Method:** `POST`
   - **Headers:** add `Authorization` with value `Bearer ` followed by your key
     (one space after `Bearer`).
   - **Request Body:** `JSON`, with three text fields:

     | Key | Value |
     | --- | --- |
     | `source` | `wallet` |
     | `text` | the **Amount** variable, a space, then the **Merchant** variable |
     | `card` | the **Card or Pass** variable |

     To insert a variable, tap the value field and pick **Shortcut Input**,
     then tap it and choose **Amount**, **Merchant** or **Card or Pass**.
7. Tap **Done**.

Menu wording changes a little between iOS versions. If a step doesn't match
what you see, the things that matter are: the trigger is **Transaction**, it
runs without asking, and it POSTs the JSON above to your URL with the
`Authorization` header.

## What happens after a tap

| Situation | What the bot does |
| --- | --- |
| It recognises the merchant | Saves it and sends the ⚡ message with Edit / Delete. |
| It isn't sure of the category | Sends the usual "Correct or not?" prompt with the amount filled in. Nothing is saved until you confirm. |
| The same amount arrives twice within 3 minutes | Saves both and marks the second with ⚠️ so you can delete it if it's a duplicate. |
| Something goes wrong | Sends "Couldn't log a payment of …" so you can type it in. |

Expenses go into your active Space, the same as ones you type.

## Troubleshooting

- **Nothing arrives in Telegram.** In Shortcuts, open the automation and check
  it ran (Automation → the automation → run history). Then repeat the `curl`
  test from step 2.
- **`401`.** The key is wrong or was replaced. Send `/autolog` and update the
  header.
- **`400`.** The JSON body is malformed: `source` must be `wallet` and `text`
  must not be empty.
- **`429`.** More than 30 captures in an hour for one key. It clears by itself.
- **The URL in `/autolog` is wrong.** Set `INGEST_URL` on the bot service
  (Railway) to the full public address, e.g.
  `https://<your-bot-host>/ingest`. By default it is derived from
  `WEBHOOK_URL`.

## Not covered

- Payments that don't go through Apple Pay (PayNow / Scan to Pay, online card
  entry, cash). Log those in the bot as before. UOB SMS capture is paused.
