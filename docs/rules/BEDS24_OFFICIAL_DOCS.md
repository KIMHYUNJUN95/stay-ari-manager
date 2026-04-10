# Beds24 Official Docs Rule

## Purpose
Use official Beds24 documentation as the primary source of truth for any Beds24-related task in this repository.

## Mandatory Rule
- For any Beds24-related question, review, bug investigation, implementation, refactor, sync change, webhook change, or behavior explanation, official Beds24 docs must be checked first before answering or changing code.
- This rule applies even when the model believes it already knows the answer.
- If the behavior could have changed, or if there is any uncertainty, do not rely on memory alone.

## Always Consult First
- `https://wiki.beds24.com/index.php/Category:API`
- `https://www.beds24.com/api/`
- `https://wiki.beds24.com/index.php/Category:API_V2#Endpoints`

## Applies To
- Beds24 API requests and response parsing
- Bookings, calendar, inventory, prices, availability, min stay, max stay
- Webhooks, sync logic, cache refresh, reconciliation, and rate-limit behavior
- Any explanation, review, bugfix, feature work, or refactor that depends on Beds24 behavior

## Source Priority
1. Official Beds24 Wiki and API pages
2. Current repository code and runtime behavior
3. Other sources only when official docs are silent

## Working Rules
- Do not assume remembered Beds24 behavior is correct when the official docs can confirm it.
- If repository behavior differs from the official docs, call out the mismatch clearly.
- If the docs are unclear, state that uncertainty instead of guessing.
- Prefer citing the exact official page or endpoint section used.
- When reviewing or changing sync logic, check webhook coverage and endpoint behavior against the official docs first.

## Response Rules
- When the answer depends on Beds24 behavior, say that the conclusion is based on official Beds24 documentation.
- If the repository intentionally differs from Beds24 docs, state both:
  - what Beds24 docs say
  - what this repository currently does
- If official docs do not clearly confirm a claim, say so explicitly instead of presenting an assumption as fact.

## Prohibited Shortcuts
- Do not treat cached project behavior as proof of actual Beds24 behavior without checking the docs.
- Do not infer webhook coverage, min stay behavior, pricing inheritance, or linked-price behavior from UI results alone.
- Do not add frontend fallbacks like "blank means 1" unless the official docs clearly support that interpretation.

## Notes
- A webhook trigger does not automatically guarantee that the webhook payload contains the full data needed by the UI or cache.
- Effective behavior in Beds24 can come from more than one rules layer, so verify what the endpoint actually returns before adding frontend fallbacks.

## Repository Reminders
- In this repository, "active roomId" for certain dual-room buildings is inferred from Beds24 calendar data and local project rules. Beds24 does not provide a native "active room" flag for this project-specific use case.
- The project currently treats high `minStay` values such as `50` or `99` as an internal inactive-room convention. This is a repository rule, not a Beds24 official meaning. If an inactive roomId still has a normal `minStay` such as `2`, the app can misidentify that roomId as active.
- Before debugging blackout placement, active-room mapping, or price sync issues on dual-room buildings, first verify the actual Beds24 calendar values for each roomId, especially `minStay`, overrides, and linked room dependencies.
- Beds24 official docs confirm that linked Daily Prices can update other linked prices when one price changes. Source: `https://wiki.beds24.com/index.php/Category:Daily_Prices`
- Beds24 official docs also confirm that "Use prices and restrictions from another room" applies Daily Prices and all Calendar restrictions from the source room. Source: `https://wiki.beds24.com/index.php/Setting/roomspricefromroom`
- Therefore, if two Beds24 roomIds are linked or use prices/restrictions from another room, changing the main room price in our app can legitimately update the linked or dependent room in Beds24. Treat this as expected Beds24 behavior unless the Beds24 dependency settings are confirmed to be absent.
