# medusajs-hitpay-skill

Agent skill for **MedusaJS v2 + HitPay** (hosted checkout, dashboard webhooks, custom Payment Module Provider).

## Install

**Cursor (this repo):** already lives at `.cursor/rules/medusajs-hitpay-skill/`.

**Another project:** copy the folder:

```bash
cp -R medusajs-hitpay-skill /path/to/project/.cursor/rules/
```

**Claude Code / universal:** copy to your skills directory, e.g. `~/.claude/skills/medusajs-hitpay-skill`.

## Use

In chat, invoke:

```text
/medusajs-hitpay-skill <your question>
```

Or ask naturally about HitPay + Medusa checkout, webhooks, or env configuration.

## Sources

- [HitPay Online Payments](https://docs.hitpayapp.com/apis/guide/online-payments)
- [Medusa — Payment Module Provider](https://docs.medusajs.com/resources/references/payment/provider)
- [Medusa — Payment webhooks](https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events)

## License

MIT (same as parent skill factory convention).
