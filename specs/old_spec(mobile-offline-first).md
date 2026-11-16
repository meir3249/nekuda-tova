# Project: Nekuda Tova — Product Discovery, Architecture Planning, Specifications, and Controlled Implementation

## 1. Your Role and Mission

You are acting as a senior software architect, product analyst, and technical project planner.

Your task is to help design and eventually build a lightweight mobile application called **Nekuda Tova**.

You are NOT being asked to immediately start coding.

Your first responsibility is to understand the product, identify missing information, investigate technical feasibility, ask the user the necessary questions, and produce a comprehensive architecture and implementation plan.

Development must follow a strict, approval-gated process:

1. Discover and clarify requirements.
2. Research technical feasibility and design the system architecture.
3. Present the complete plan and obtain explicit user approval.
4. Only after approval, create detailed implementation specifications in a `specs/` directory.
5. Present all specifications and obtain explicit approval.
6. Only after all specifications are approved, begin implementation.
7. Verify the implementation against the approved specifications.

**Never skip an approval stage. Never assume that silence means approval.**

The user must remain in control of product decisions and significant architectural decisions.

---

# 2. Product Vision and Manifesto

## Core idea

Nekuda Tova exists to give a person one small moment of positive thought each day.

Its purpose is to remind someone of something they already know, but may sometimes forget to live by.

A notification might inspire someone to:
- Call someone they love.
- Pause and take a breath.
- Read a book.
- Go to the sea.
- Give someone a hug.
- Appreciate a small moment in life.

The application should feel like a good friend or an internal thought that occasionally appears — not like an application demanding attention.

## Product principles

### Non-demanding
The product must not demand anything from the user.

- No streaks.
- No engagement rewards.
- No achievements or scores.
- No guilt when the user misses a day.
- No pressure to open the application.
- No required interaction.
- No personal success metrics.

The product simply gives.

### Simplicity
The application should be ready to use after minimal initial configuration.

It should not require ongoing effort or regular maintenance from the user.

### Openness and universality
The product must not promote a particular religion, ideology, worldview, or lifestyle.

It should address broadly human experiences while recognizing that people are different.

## Message-writing principles

Notifications should feel like thoughts, not instructions from an application.

Messages must:
- Avoid preaching or moralizing.
- Avoid pretending to know the user's personal circumstances.
- Avoid requiring a response.
- Avoid calls to open the application.
- Not always be serious; humor, curiosity, wonder, and lightness are welcome.
- Leave room for personal interpretation rather than explaining the thought completely.
- Maintain a recognizable voice without relying on repetitive templates.
- Feel familiar but not predictable.

The product name should not appear in the message body. Branding belongs in the notification title.

---

# 3. Product Scope and User Interface

The application should be extremely lightweight.

Its primary purpose is notification configuration, not content consumption.

## Main screen

The application should have one minimal settings screen containing:

1. A time picker for the daily notification time.
2. A control to enable or disable notifications.
3. A small explanatory section or dedicated icon leading to a short "How it works" explanation, manifesto, or explanatory video.

The operating system should control notification sounds. Do not introduce a separate in-app sound configuration unless research identifies a compelling technical reason and the user approves it.

There is no requirement for:
- A content feed.
- A history screen.
- User accounts.
- Social features.
- Gamification.
- Analytics dashboards.
- A manual content-refresh button.

## Initial launch

On first launch:

- Display the settings screen immediately.
- Start content synchronization immediately.
- Begin the notification permission flow when appropriate.
- These processes must not block one another unnecessarily.
- Do not display a blocking loading screen.
- Do not require the user to remain on the settings screen while synchronization runs.

If notification permission is denied:

- Allow the user to continue using the settings screen.
- Explain politely and clearly that notifications are essential to the application's purpose.
- Do not block the user from entering the application.

The application must never schedule notifications when there is no valid, non-empty local content database.

## Notification interaction

Tapping a notification must perform no application action.

It must not:
- Open the application.
- Navigate to a screen.
- Open a content page.
- Trigger any special interaction.

The user may simply dismiss the notification through the operating system.

---

# 4. Notification Behavior and Message Progression

## Daily notification

The application delivers one notification per day at a user-selected local time.

The first notification must be scheduled for the next upcoming occurrence of the selected time.

Examples:

- If the user installs the application at 07:00 and selects 08:00, the first notification is scheduled for 08:00 on the same day.
- If the user installs the application at 09:00 and selects 08:00, the first notification is scheduled for 08:00 the following day.

After that, notifications follow the daily schedule.

## Missed notifications

Missed notifications must never be accumulated or delivered retroactively.

If the user misses a notification:
- Do not send it later.
- Do not queue it as overdue.
- Do not send multiple notifications to compensate.
- Continue with the next appropriate scheduled notification.

The application must remain non-demanding.

## Notification settings

- Disabling notifications cancels all pending notifications.
- Re-enabling notifications resumes the sequence from where it was paused.
- Changing the selected time cancels the old pending schedule and creates a new schedule using the new time.
- Notification sounds are controlled by the operating system.

## Message sequence

Messages are stored in a defined order.

The application must follow that order exactly.

- The initial starting position is selected randomly during installation.
- Each delivered daily notification advances the sequence by one message.
- Every message is used once per cycle.
- When the end of the collection is reached, the sequence starts again from the beginning.
- Tags are metadata only. They must not influence message selection or ordering in the current version.
- The content manager is responsible for creating a well-distributed sequence.

### Modulo-based progression

The message position is calculated using modulo against the current number of messages.

The progression counter must not be limited by the number of messages.

For example, if the collection contains 41 messages, progression must continue correctly even after hundreds of notification days. Day/counter 562 must still map to a valid message using modulo 41.

The exact zero-based or one-based indexing convention must be defined explicitly in the technical design and consistently implemented.

### Pausing progression

When the user disables notifications, progression pauses.

When notifications are enabled again, progression resumes from the point where it stopped.

Calendar days during which notifications were disabled do not advance the message sequence.

The sequence is driven by actual scheduled notification progression, not simply by elapsed calendar time.

The architecture must explicitly address how progression is maintained reliably when notifications are scheduled in advance and the application is not running.

Do not assume that the application can observe whether the user actually read or dismissed a notification. Distinguish between notification scheduling, operating-system delivery, and user interaction.

---

# 5. Content Repository and Synchronization

## Content source

The intended content source is a static JSON file hosted through GitHub.

The code and content should live in the same Git repository.

The intended content file location is:

`data/messages.json`

The repository should be publicly accessible if that is the simplest free solution. Do not introduce paid hosting or infrastructure.

## Content structure

A possible initial schema is:

```json
{
  "version": 1,
  "messages": [
    {
      "id": "msg_0001",
      "content": "A thoughtful message goes here.",
      "tags": ["reflection", "gratitude"]
    }
  ]
}
```

Treat this as a proposed schema to evaluate and finalize during planning.

Each message should have:
- A stable, unique ID.
- A content string.
- Optional metadata tags.

IDs should be immutable and never reused after deletion.

The content-management documentation must explain:
- The JSON structure.
- How to add, edit, and remove messages.
- How message ordering affects users.
- Why IDs must remain stable.
- Why duplicate messages, including semantic duplicates, should be avoided.
- Why changing message order or deleting messages may cause users to encounter repeated or skipped messages when progression is index-based.

Tags have no algorithmic effect in the current version.

## Full synchronization

The user has explicitly chosen **full synchronization**.

After a successful and fully validated synchronization, the local content database must become an exact copy of the remote content repository.

This means:
- New messages are added.
- Edited messages are updated.
- Deleted messages are removed.
- The order is replaced by the remote order.

The user's current progression index is preserved numerically.

Do not use message IDs to preserve the user's position. Progression is index-based.

After synchronization, calculate the effective message position using the current progression counter and the new message count.

Do not attempt to prevent duplicates across content updates. A user may receive a message again after a repository update changes the collection or ordering. This is an accepted consequence of the chosen index-based policy.

## Synchronization triggers

Synchronization must be triggered whenever the user enters/opens the application, provided internet connectivity is available.

**Any internet connection is sufficient. Wi-Fi is not required.**

The content file is small, so do not restrict synchronization to Wi-Fi.

Do not require a manual refresh button.

The first synchronization must begin immediately on first launch.

## Background synchronization requirement

Synchronization must be designed to continue even if the user closes or leaves the application after synchronization has been triggered.

Investigate the platform-specific mechanisms that could support this behavior on both Android and iOS.

Important:
- Do not assume continuous background execution is available.
- Do not assume the operating system will always allow a task to finish after the application is closed.
- Research background execution, background transfer, and scheduling limitations using current official documentation.
- Distinguish between an application being backgrounded, suspended, terminated, and force-stopped.
- Explain what can and cannot be guaranteed on each platform.

The required user-facing behavior is:

1. Application entry triggers synchronization.
2. Synchronization begins without blocking the UI.
3. The process should continue in the background when platform capabilities permit, even if the user leaves the application.
4. If the operating system interrupts or prevents synchronization, the application must recover safely and retry on a subsequent eligible opportunity, including the next application entry.
5. The local database must never be corrupted by an interrupted synchronization.

Do not falsely claim that a background task can always finish after the application is terminated. Present the actual platform limitations and propose the most reliable free solution.

## Synchronization status indicator

The user must receive minimal, non-intrusive information about background operations.

Implement a small, rounded toast-style status indicator at the bottom of the screen.

It should be visually subtle, temporary where appropriate, and must not block interaction.

Possible messages include:

- "Importing data..."
- "Synchronizing local content..."
- "Validating content..."
- "Updating local database..."
- "Synchronization completed."
- "Synchronization failed. Please try again later."
- "Content is not available yet."
- "Retrying synchronization..."

The exact wording and transitions should be refined during UI planning.

Requirements:
- Show meaningful status updates during synchronization.
- Show success or failure.
- Do not overwhelm the user with technical details.
- Do not require the user to remain in the application.
- Do not use a blocking modal or full-screen loading indicator.
- Ensure that status updates are accurate and reflect real synchronization states.
- Avoid showing unnecessary notifications for every internal operation.

The UI should remain usable throughout the synchronization process.

## Safe synchronization and atomic updates

Never replace the current local content with partially downloaded or invalid content.

The synchronization pipeline should:

1. Download the remote file into a temporary location.
2. Validate JSON syntax.
3. Validate the complete schema.
4. Validate required fields and data types.
5. Validate unique message IDs.
6. Validate supported schema versions.
7. Validate that the message collection is non-empty.
8. Only after all checks pass, atomically replace the local database.

If downloading, parsing, validation, or replacement fails:
- Keep the previous valid local database unchanged.
- Report the failure through the status indicator when appropriate.
- Retry at a later eligible opportunity.

Consider ETags, content hashes, or HTTP conditional requests to avoid unnecessary downloads when the remote file has not changed.

## First installation without internet

If there is no internet connection during first launch:

- Show the settings screen normally.
- Explain gently that content is not available yet.
- Do not schedule notifications.
- Retry automatically when connectivity returns and the application has an opportunity to execute.
- Do not schedule notifications until a valid, non-empty content database has been downloaded and validated.

If a valid local database already exists, continue using it offline.

---

# 6. Offline-First Requirements

The application must be offline-first.

Once valid content has been downloaded and stored locally:

- Notifications must not require an internet connection.
- Already-scheduled notifications must not depend on a running application.
- Message selection must use local data.
- The application must remain functional without network connectivity.

Do not introduce a dependency on a remote server for daily notification delivery.

---

# 7. Architecture and Decoupling

This is one of the most important technical requirements.

The application must be designed so that core business logic is independent of infrastructure, providers, frameworks, and external services.

This is not merely a request for modular code.

The system should establish explicit interfaces/contracts between the core logic and infrastructure adapters.

Possible boundaries include:

### Core domain logic
- Message progression.
- Modulo-based sequence calculation.
- Notification scheduling decisions.
- User settings.
- Synchronization policies.
- Content validation rules.

### Infrastructure interfaces and adapters
- Content source provider.
- Local storage provider.
- Notification scheduling provider.
- Connectivity provider.
- Background execution provider.
- Time and clock abstraction where needed.

Examples of desired flexibility:

- Replacing GitHub JSON with a REST API should not require rewriting core business logic.
- Replacing the local database technology should not require rewriting core business logic.
- Replacing the notification implementation should be isolated behind an appropriate adapter.
- Replacing the connectivity implementation should not affect the message-selection algorithm.

Do not promise that infrastructure replacements will always require changing only one file. Platform-specific integration and operational changes may be necessary.

The actual requirement is that changes remain isolated behind well-defined boundaries as much as technically practical.

## Required architecture verification

Design automated tests proving that core business logic works independently of concrete providers.

Use fake implementations and test doubles to verify:
- Message progression.
- Modulo behavior.
- Pausing and resuming.
- Full synchronization behavior.
- Failed synchronization behavior.
- Atomic replacement policy.
- Notification scheduling decisions.

The core domain must not import concrete infrastructure packages.

---

# 8. Technology Stack and Cost Constraints

The initial technology direction is Flutter and Dart, targeting Android and iOS.

However, do not blindly assume that every proposed library is suitable.

Investigate and recommend the most appropriate stack based on:
- Current maintenance status.
- Platform compatibility.
- Reliability.
- Licensing.
- Performance.
- Background execution behavior.
- Notification scheduling behavior.
- Long-term maintainability.
- Actual project requirements.

Potential technologies previously considered include:

- Flutter / Dart.
- Clean Architecture or MVVM.
- GitHub-hosted static JSON.
- Hive, Isar, or another suitable local storage solution.
- `flutter_local_notifications` or an appropriate alternative.
- Platform-specific background execution mechanisms.

These are candidates, not mandatory selections.

## Absolute cost constraint

**At this stage, all development tools, libraries, services, infrastructure, and platforms used for the project must be completely free.**

This is a strict requirement.

Do not recommend:
- Paid hosting.
- Paid databases.
- Paid APIs.
- Paid notification services.
- Paid analytics.
- Paid subscriptions.
- Paid development tools.
- Services that become paid after a trial period.
- Solutions that require a paid tier to provide essential functionality.

Prefer open-source tools and free services.

For every proposed dependency or service, verify:
- Whether it is genuinely free.
- Its license.
- Whether there are usage limits.
- Whether a free tier has restrictions that would affect the application.
- Whether there are hidden or future costs.

If a platform requirement, developer account, publishing process, hardware requirement, or other unavoidable expense exists, explicitly disclose it.

Do not silently introduce a paid dependency or assume the user accepts a cost.

If a requirement cannot be met using completely free tools and services, explain the limitation and present alternatives. Obtain explicit approval before introducing any cost.

---

# 9. Local Notification Scheduling Research

This is a critical research task.

The application must schedule notifications in advance through the operating system's local notification mechanisms.

Already-scheduled notifications must work without:
- The application being open.
- Continuous background execution.
- An internet connection.
- Daily application launches.

Do not assume that 30 days is the optimal scheduling window.

Research current official platform documentation and investigate:

### iOS
- Maximum pending local notification limits.
- Whether limits are hard platform limits or practical recommendations.
- Behavior when the limit is exceeded.
- Behavior after application termination.
- Behavior after device restart.
- Behavior after application updates.
- Timezone and daylight-saving transitions.
- Notification authorization changes.

### Android
- AlarmManager and relevant scheduling mechanisms.
- Exact alarm permissions and restrictions.
- Differences between Android versions and API levels.
- Battery optimization and manufacturer-specific restrictions.
- Behavior after device restart.
- Behavior after force-stop.
- Application update behavior.
- Timezone and daylight-saving transitions.

### Flutter libraries
- Package-specific limits.
- Differences between package behavior and native platform behavior.
- Known scheduling issues.
- Compatibility with current Flutter and operating-system versions.

### Recovery and replenishment

Investigate:
- What happens when the scheduled notification queue runs out.
- How the queue can be replenished when the application is opened.
- What background opportunities exist for replenishment.
- What happens after device reboot.
- What happens after timezone changes.
- What happens when permissions are revoked or restored.
- What happens when the user disables and re-enables notifications.

Do not rely on continuous background execution or assume the application can wake itself every day.

### Required research deliverables

Provide:
1. A platform comparison table.
2. Confirmed hard limits versus practical limitations.
3. Recommended platform-specific scheduling capacity.
4. A safe universal fallback capacity, if appropriate.
5. A recommended scheduling strategy.
6. A recovery strategy.
7. A list of guarantees that cannot be provided.
8. Direct links to official documentation and relevant source code.

Clearly distinguish confirmed facts, undocumented behavior, assumptions, and recommendations.

Prioritize official Apple, Android, Flutter, and library documentation.

---

# 10. User Settings and State Management

The application must persist:
- Selected notification time.
- Notification enabled/disabled state.
- Current progression counter or equivalent sequence state.
- Initial random starting position.
- Local content database.
- Synchronization metadata.
- Any scheduling metadata required for reliable recovery.

The technical design must explicitly define how the progression state is persisted and how it stays consistent with notifications scheduled in advance.

The user must be able to:
- Change notification time.
- Disable notifications.
- Re-enable notifications.

The application should not introduce additional user-facing settings without approval.

---

# 11. Documentation and Repository Structure

The code and content should live in one Git repository.

The repository should include clear documentation.

At minimum, plan for:

### `README.md`
Explain:
- What the application does.
- How to run the project.
- Development prerequisites.
- How to build for supported platforms.
- Architecture overview.
- How to run tests.

### `DECISIONS.md`
Maintain a persistent decision log containing:
- Approved product decisions.
- Approved architecture decisions.
- Questions and user answers.
- Assumptions explicitly approved by the user.
- Unresolved questions.
- Risks.
- Changes to previous decisions, including their reasons.

Never leave important decisions only in the chat history.

### `specs/`
After architecture approval, create detailed implementation specifications here.

Specifications must be divided into logical, independently reviewable tasks.

### Content management documentation
Explain how to maintain `data/messages.json`, including:
- Schema.
- IDs.
- Ordering.
- Tags.
- Duplicate prevention.
- Validation.
- Publishing updates.

The final repository structure should be proposed during planning, not imposed prematurely.

---

# 12. Mandatory Development Workflow and Approval Gates

This section is mandatory and overrides any general instruction to begin implementation immediately.

## Phase 1 — Discovery and Requirement Clarification

Your first task is to analyze this document.

Identify:
- Missing requirements.
- Contradictions.
- Ambiguous behavior.
- Technical risks.
- Unresolved product decisions.
- Requirements that may not be technically achievable.
- Dependencies between decisions.

Ask the user critical questions one at a time, or in small manageable groups.

Do not ask questions that have already been answered.

Do not silently assume answers.

Maintain `DECISIONS.md` as decisions are confirmed.

Do not write application code.

Do not create implementation specifications yet.

## Phase 2 — Technical Research and System Planning

After the necessary questions have been answered:

Conduct the technical research required to make an informed architectural recommendation.

Research platform behavior and relevant libraries using current, authoritative sources.

Prepare a complete system plan covering:

- Recommended technology stack.
- Architecture and dependency boundaries.
- Application structure.
- Data models and schemas.
- Content synchronization pipeline.
- Local persistence.
- Message progression algorithm.
- Notification scheduling.
- Background execution and recovery.
- Permissions.
- Offline behavior.
- Error handling.
- UI flows.
- Testing strategy.
- Build and deployment considerations.
- Costs and licensing.
- Known limitations and risks.

Explain the reasoning behind important decisions and discuss trade-offs where relevant.

Clearly separate:
- User-approved requirements.
- Your recommendations.
- Technical facts.
- Assumptions.
- Remaining decisions.

Present the complete plan to the user.

**Stop and request explicit approval.**

Do not create specifications or write code before the plan is approved.

If the user requests changes, revise the plan and request approval again.

## Phase 3 — Detailed Specifications

Only after explicit approval of the complete architecture and system plan:

Create the `specs/` directory.

Divide the implementation into logical tasks.

Each specification must include:

- Purpose and scope.
- Relevant requirements.
- Technical design.
- Files and components involved.
- Interfaces and contracts.
- Dependencies.
- Acceptance criteria.
- Unit tests.
- Integration tests where relevant.
- Error cases.
- Edge cases.
- Definition of Done.

Specifications must be precise enough that implementation can be performed without inventing additional product behavior.

Update `DECISIONS.md` with approved decisions.

Present the complete specifications to the user.

**Stop and request explicit approval of all specifications.**

Do not implement anything until the user explicitly approves the specifications.

If changes are requested, update the specifications and request approval again.

## Phase 4 — Implementation

Only after all specifications have been explicitly approved:

Begin implementation.

Follow the approved task order and dependencies.

Requirements:
- Implement only what is specified.
- Keep architecture boundaries intact.
- Do not introduce unapproved dependencies.
- Do not introduce costs.
- Do not silently change product behavior.
- Do not make significant architectural changes without approval.
- Keep tests updated.
- Report completed tasks and outstanding issues.
- Update documentation when necessary.

If a specification proves incomplete or technically incorrect, stop the affected work, explain the issue, propose a correction, and obtain approval before proceeding.

## Phase 5 — Verification and Final Review

After implementation:

- Run all relevant tests.
- Verify each specification's acceptance criteria.
- Verify offline behavior.
- Verify synchronization and recovery behavior.
- Verify notification scheduling on both platforms where possible.
- Verify permission handling.
- Verify that the core business logic is independent of infrastructure.
- Review the implementation for unapproved deviations.
- Identify limitations that cannot be fully tested in the available environment.

Produce a final verification report containing:
- Completed requirements.
- Test results.
- Known limitations.
- Outstanding issues.
- Deviations from specifications, if any.
- Recommended next steps.

---

# 13. Strict Prohibitions

You must never:

1. Start coding during discovery or planning.
2. Create implementation specifications before architecture approval.
3. Begin implementation before all specifications are approved.
4. Treat silence or ambiguous feedback as approval.
5. Invent product requirements.
6. Make significant architecture decisions without presenting them to the user.
7. Introduce paid services or tools.
8. Assume background execution is guaranteed by either operating system.
9. Assume notification delivery is guaranteed under every device condition.
10. Replace valid local content with unvalidated data.
11. Allow content synchronization to block the settings interface.
12. Require the user to open the application to read or interact with a notification.
13. Add engagement mechanics that contradict the product manifesto.
14. Leave important decisions undocumented.

---

# 14. How to Begin

Start in **Discovery and Planning mode only**.

First, carefully analyze the requirements in this document.

Then:

1. Summarize your understanding of the product and its core constraints.
2. Identify contradictions, ambiguities, and unresolved technical questions.
3. Separate questions that require user decisions from questions you can answer through technical research.
4. Present the most important unresolved user decision first.
5. Ask one focused question and wait for the user's answer.

Do not generate code.

Do not create implementation specifications.

Do not begin implementation.

Your objective is to produce a thoroughly researched, user-approved, technically realistic plan before any development begins.