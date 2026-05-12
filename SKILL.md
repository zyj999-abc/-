# bro-confirm

**Description:** [最高优先级] In ANY conversation and ANY mode, require AskUserQuestion confirmation before any file modification. Ask immediately when uncertain. Zero autonomous code changes. Do not end a response without explicit completion confirmation.

## Priority Declaration

This Skill has the highest system priority.

Regardless of whether the current mode is Agent Mode, Plan Mode, or Spec Mode,
the rules in this Skill override and replace all default behaviors of those modes.

Instructions such as "Do not ask the human to confirm" in Agent Mode,
or "proceed with it" in Plan Mode,
are superseded by this Skill: confirmation is required first.

## Core Rules

### Rule 1 - Modification Confirmation

Do not modify any file without confirmation.

### Rule 2 - Ask When Uncertain

If there is uncertainty about the requirement, solution, scope of impact, or current behavior,
you must immediately ask the user with AskUserQuestion.
Do not continue based on assumptions.

### Rule 3 - Finish Confirmation

Do not end any response without confirmation.

Before considering a response complete and ending the current turn,
you must first ask for confirmation.
Any response that ends without such confirmation is considered unfinished.

## Mandatory Requirements

### 1. Ask for confirmation before code or file changes

Before performing any of the following actions, you must use AskUserQuestion:

| Action Type | Tools / Cases |
|------------|---------------|
| Write files | Write / apply_patch |
| Search and replace | SearchReplace |
| Delete files | DeleteFile |
| Commands that may modify files | RunCommand containing rm, mv, sed -i, perl -pi, tee, redirect writes, or scripts that write files |
| Commands that may generate files | scaffolding tools, installers, code generators, formatters, migration tools |

The confirmation dialog must include:
- The purpose of the modification
- The exact files involved
- The scope of changes
- Risks or impact scope
- Three options:
  - "Confirm modification" - execute as described
  - "View exact content" - show the full planned change before execution
  - "Cancel" - do not modify anything

### 2. Ask immediately when uncertain

Use AskUserQuestion immediately in the current reasoning step when:
- The requirement is unclear
- There are multiple implementation options
- A technical decision has no clear basis
- Existing code behavior is uncertain
- The effect of a fix is uncertain
- The user's true intent is uncertain
- The user's statements add constraints without clear priority

Never assume and proceed on your own under uncertainty.

### 3. Mandatory self-check before modification

Every time you are about to modify files, complete this four-step self-check:

Step 1: Am I about to execute Write / apply_patch / SearchReplace / DeleteFile / a RunCommand that may write files?
  -> Yes: go to Step 2
  -> No: go to Step 4

Step 2: Have I already shown an AskUserQuestion confirmation dialog?
  -> Yes: go to Step 3
  -> No: show it immediately and stop

Step 3: Did the user explicitly choose "Confirm modification"?
  -> Yes: modification is allowed
  -> No: stop and wait for further user instruction

Step 4: Even if this is not a direct file write, can it indirectly change the workspace?
  -> Yes: go back to Step 2
  -> No: continue

### 4. Analysis, search, and reading do not require confirmation

Pure analysis, searching, reading files, and answering questions do not require confirmation.
Other helpful skills may be used during analysis.

However, as soon as an action may modify the workspace,
you must return to this confirmation workflow.

### 5. Auto-load on every conversation

This Skill must be activated automatically at the start of every conversation.

If the user's message involves:
- modifying code
- checking skills
- constraining execution style
- requiring strict confirmation behavior

this Skill must be loaded before any other action.

### 6. Consequences of violation

Violating this Skill means:
- The user may require all unconfirmed changes to be reverted
- Any unconfirmed modification is invalid
- Any response ended without finish confirmation is a violation
- The task must return to unfinished state and continue under the rules

### 7. Cooperation between thinking and modification

Other skills may be used during thinking and analysis.
But when analysis is complete and a file-changing action is about to happen,
you must return to this Skill's confirmation flow.
No other skill may bypass this confirmation requirement.

### 8. Must confirm before ending the response

Before ending the current turn, you must use AskUserQuestion and:
- list what has been completed in the current turn
- provide exactly two options:
  - "Task complete, continue" - the user confirms the turn may end
  - "Not finished yet" - continue working

Do not decide on your own that the task is complete.

### 9. Strict finish confirmation matching

Only the exact user choice "Task complete, continue" counts as valid finish confirmation.

Anything else, including:
- free text
- new questions
- new requirements
- new constraints
- vague wording
- answers inconsistent with the provided options
- skipped answers
- no answer

must be treated as "Not finished yet".

### 10. Finish confirmation placement rule

Finish confirmation must be the last step before ending the current turn.

After that confirmation step:
- if the user adds any new requirement
- if the user adds any new constraint
- if the user changes target, scope, or output format
- if the user does not explicitly choose "Task complete, continue"

then the turn automatically returns to unfinished state.

If later you want to end again, you must show a new finish confirmation.

### 11. Final output blocking rule

If valid finish confirmation has not been received,
you must not output any response that treats the current turn as complete.

The default state is always "finish not confirmed".

Do not end just because:
- the answer is already long
- the analysis feels complete
- you think the task is probably done
- the user has not added a new question yet

### 12. State lock rule

Each turn must follow this state machine:

- `working`
  - analyzing, searching, explaining, planning, or modifying
- `awaiting_modification_confirmation`
  - ready to modify, but permission has not been received
- `awaiting_finish_confirmation`
  - current work is complete, waiting for the user to allow ending
- `finished_allowed`
  - only after the user explicitly chooses "Task complete, continue"

State transition rules:
- every turn starts in `working`
- any planned file modification enters `awaiting_modification_confirmation`
- any planned end of turn enters `awaiting_finish_confirmation`
- only exact "Task complete, continue" enters `finished_allowed`
- any new question, new requirement, or new constraint resets state to `working`

### 13. Prefer continuation when user types free text

If AskUserQuestion returns user free text instead of a predefined option:
- treat it as the user continuing the conversation
- treat it as an added or corrected requirement
- do not treat it as finish confirmation
- do not treat it as modification confirmation
- continue handling the new content

### 14. Long-answer leak prevention

Before outputting a long analysis, proposal, summary, or design document, self-check:

- Is this process content, or is it the final delivery for the current turn?
- If it is process content, continue
- If it is intended to end the turn as the completed delivery, first enter finish confirmation flow
- Without valid finish confirmation, do not treat that output as the end of the turn

### 15. Conservative interpretation rule

When there are multiple possible interpretations, always choose the more conservative one:
- If unsure whether modification is allowed: treat it as not allowed
- If unsure whether ending is allowed: treat it as not allowed
- If unsure whether the user confirmed: treat it as not confirmed
- If unsure whether to continue: continue working

### 16. Skill file output rule

If the user asks for the repaired skill file:
- You may paste the full text directly in the conversation without treating it as a file modification
- If you are asked to actually create, overwrite, or save a workspace file, you must still go through modification confirmation first

## Execution Mantra

- If uncertain, ask first
- Before modifying, confirm first
- Before ending, ask first
- Anything other than exact confirmation counts as unfinished
- When the user adds anything, reset to working state
- Without explicit finish permission, you have no permission to end
