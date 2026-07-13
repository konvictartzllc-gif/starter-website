const INTENT_PATTERNS = [
        { key: "schedule", regex: /\b(schedule|book|appointment|set up|add to (my )?calendar)\b/i },
        { key: "call", regex: /\b(call|ring|phone|dial)\b/i },
        { key: "remind", regex: /\b(remind|reminder|remember to)\b/i },
];

export class DexIntentEngine {
        classify_intent(message = "", context = {}) {
                const text = String(message || "").trim();
                const safetySignal = context.detectSafetySignal?.(text) || { level: "none" };
                const emergencyContactRequested = Boolean(context.isEmergencyContactAlertRequest?.(text));
                const webRequest = context.extractWebRequest?.(text) || null;

                if (context.detectSensitiveInfo?.(text)) {
                        return { key: "sensitive_info", confidence: 1, safetySignal, emergencyContactRequested };
                }

                if (safetySignal.level === "emergency" || emergencyContactRequested) {
                        return { key: "emergency", confidence: 1, safetySignal, emergencyContactRequested };
                }

                if (safetySignal.level === "support" || safetySignal.level === "urgent_support") {
                        return { key: "support", confidence: 0.95, safetySignal, emergencyContactRequested };
                }

                if (webRequest) {
                        return { key: webRequest.type === "youtube" ? "youtube" : "web_search", confidence: 0.9, webRequest };
                }

                const matchedAction = INTENT_PATTERNS.find((intent) => intent.regex.test(text));
                if (matchedAction) {
                        return { key: matchedAction.key, confidence: 0.75, actionIntent: matchedAction.key };
                }

                return { key: "conversation", confidence: 0.5 };
        }

        extract_parameters(message = "", intent = {}, context = {}) {
                const text = String(message || "").trim();
                return {
                        message: text,
                        actionIntent: intent.actionIntent || this.get_action_intent(text),
                        webRequest: intent.webRequest || context.extractWebRequest?.(text) || null,
                        safetySignal: intent.safetySignal || context.detectSafetySignal?.(text) || { level: "none" },
                        emergencyContactRequested: Boolean(intent.emergencyContactRequested),
                        voiceSignals: context.voiceSignals,
                        userId: context.userId,
                };
        }

        route_to_action(intent = {}, parameters = {}) {
                const actionMap = {
                        sensitive_info: "warn_sensitive_info",
                        emergency: "handle_emergency",
                        support: "handle_support",
                        web_search: "handle_web_request",
                        youtube: "handle_web_request",
                        schedule: "conversation_with_schedule_intent",
                        call: "conversation_with_call_intent",
                        remind: "conversation_with_reminder_intent",
                        conversation: "conversation",
                };

                return {
                        name: actionMap[intent.key] || "conversation",
                        intent: intent.key || "conversation",
                        actionIntent: parameters.actionIntent || null,
                        confidence: intent.confidence || 0,
                };
        }

        async execute_action(route = {}, parameters = {}, handlers = {}) {
                const handler = handlers[route.name];
                if (typeof handler !== "function") return null;
                return handler(parameters, route);
        }

        get_action_intent(message = "") {
                const text = String(message || "").trim();
                return INTENT_PATTERNS.find((intent) => intent.regex.test(text))?.key || null;
        }
}

export const dexIntentEngine = new DexIntentEngine();
