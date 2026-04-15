import { normalizeNotificationLocale } from "./notification-email-locales"
import { OrderNotificationEmailKeys } from "./order-notification-email-keys"

type NoticePair = { headline: string; message: string }

/**
 * Built-in translations for system-provided `noticeHeadline` / `noticeMessage`.
 * Keys: {@link OrderNotificationEmailKeys} string values. Sub-keys: locale (e.g. fr, de).
 * Locales not listed here use the English strings passed from subscribers / routes.
 *
 * Add or edit entries to support more languages.
 */
const ORDER_NOTICE_I18N: Partial<Record<string, Record<string, NoticePair>>> = {
  [OrderNotificationEmailKeys.ORDER_PROCESSING]: {
    fr: {
      headline: "Nous préparons votre commande",
      message:
        "Merci — votre paiement a bien été enregistré. Nous préparons votre commande.",
    },
  },
  [OrderNotificationEmailKeys.ORDER_PAYMENT_FAILED]: {
    fr: {
      headline: "Action requise pour votre paiement",
      message:
        "Nous n'avons pas pu finaliser votre paiement automatiquement. Veuillez retourner au paiement ou à votre commande pour réessayer ou utiliser un autre moyen de paiement.",
    },
  },
  [OrderNotificationEmailKeys.ORDER_IN_FULFILLMENT]: {
    fr: {
      headline: "Votre commande est en préparation",
      message:
        "Nous avons commencé à préparer votre commande. Vous recevrez une nouvelle mise à jour lors de l'expédition.",
    },
  },
  [OrderNotificationEmailKeys.ORDER_SHIPMENT_IN_PROGRESS]: {
    fr: {
      headline: "Votre commande est en route",
      message:
        "Un envoi a été créé pour votre commande. Utilisez le suivi sur la boutique ou le site du transporteur si disponible.",
    },
  },
  [OrderNotificationEmailKeys.ORDER_DELIVERED]: {
    fr: {
      headline: "Livré",
      message:
        "Votre commande a été marquée comme livrée. Merci pour votre achat !",
    },
  },
  [OrderNotificationEmailKeys.ORDER_CANCELLED]: {
    fr: {
      headline: "Commande annulée",
      message:
        "Votre commande a été annulée. Si vous n'êtes pas à l'origine de cette demande, contactez-nous.",
    },
  },
  [OrderNotificationEmailKeys.ORDER_REFUNDED]: {
    fr: {
      headline: "Remboursement effectué",
      message:
        "Un remboursement a été émis pour votre commande. Selon votre banque, il peut apparaître sous quelques jours.",
    },
  },
  [OrderNotificationEmailKeys.ORDER_DEFERRED_INVOICE]: {
    fr: {
      headline: "Votre commande est prête à être payée",
      message:
        "Nous avons mis à jour le montant de votre commande (frais de port le cas échéant). Utilisez le lien ci-dessous pour finaliser le paiement.",
    },
  },
}

/**
 * Returns locale-specific notice copy when defined in {@link ORDER_NOTICE_I18N};
 * otherwise returns `fallback` (typically English from the caller).
 */
export function translateOrderNotificationNotice(
  templateKey: string,
  locale: string,
  fallback: NoticePair
): NoticePair {
  const forTemplate = ORDER_NOTICE_I18N[templateKey]
  if (!forTemplate) {
    return fallback
  }

  const n = normalizeNotificationLocale(locale)
  const primary = n.split("-")[0] ?? n

  const hit =
    forTemplate[n] ?? (primary !== n ? forTemplate[primary] : undefined)

  return hit ?? fallback
}
