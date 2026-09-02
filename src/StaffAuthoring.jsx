import { useEffect, useMemo, useState } from "react";
import "./staff-authoring.css";
import {
  discardStaffDraft,
  emptyDay as day,
  emptyLesson as lesson,
  emptyWeek as week,
  loadStaffDraft,
  planToAuthoringWeeks,
  saveStaffDraft,
  staffDraftKey,
} from "./staff-drafts.js";
const lines = (value) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

export function StaffAuthoring({
  householdId,
  userId,
  serviceCase,
  plan,
  deliveries,
  repository,
  act,
}) {
  const draftKey = useMemo(
    () => staffDraftKey({ householdId, caseId: serviceCase.id, userId }),
    [householdId, serviceCase.id, userId],
  );
  const recovered = useMemo(
    () => loadStaffDraft(globalThis.sessionStorage, draftKey),
    [draftKey],
  );
  const [weeks, setWeeks] = useState(recovered?.weeks ?? [week(1)]);
  const [draftState, setDraftState] = useState(
    recovered ? "recovered" : "clean",
  );
  const [resource, setResource] = useState({
    title: "",
    url: "",
    requirement: "optional",
    accessType: "free",
    region: "Canada",
    estimatedCostCents: "",
    attribution: "",
    reviewed: false,
    substituteResourceId: "",
  });
  const [resourceLessonId, setResourceLessonId] = useState("");
  useEffect(() => {
    if (draftState === "clean") return;
    saveStaffDraft(globalThis.sessionStorage, draftKey, weeks);
    if (draftState !== "saved") setDraftState("saved");
  }, [draftKey, draftState, weeks]);
  const updateWeeks = (updater) => {
    setWeeks(updater);
    setDraftState("changed");
  };
  const updateWeek = (wi, key, value) =>
    updateWeeks((all) =>
      all.map((item, index) =>
        index === wi ? { ...item, [key]: value } : item,
      ),
    );
  const updateDay = (wi, di, key, value) =>
    updateWeeks((all) =>
      all.map((item, index) =>
        index === wi
          ? {
              ...item,
              days: item.days.map((entry, j) =>
                j === di ? { ...entry, [key]: value } : entry,
              ),
            }
          : item,
      ),
    );
  const updateLesson = (wi, di, li, key, value) =>
    updateWeeks((all) =>
      all.map((item, index) =>
        index === wi
          ? {
              ...item,
              days: item.days.map((entry, j) =>
                j === di
                  ? {
                      ...entry,
                      lessons: entry.lessons.map((part, k) =>
                        k === li ? { ...part, [key]: value } : part,
                      ),
                    }
                  : entry,
              ),
            }
          : item,
      ),
    );
  const document = () => ({
    weeks: weeks.map((w, wi) => ({
      number: wi + 1,
      theme: w.theme,
      days: w.days.map((d, di) => ({
        number: di + 1,
        plannedDate: d.plannedDate || null,
        lessons: d.lessons.map((l) => ({
          ...l,
          instructions: lines(l.instructions),
          materials: lines(l.materials),
          accommodations: lines(l.accommodations),
          adultHelpMinutes:
            l.adultHelpMinutes === "" ? null : Number(l.adultHelpMinutes),
        })),
      })),
    })),
  });
  const editable = [
    "drafting",
    "internal_review",
    "revision_requested",
  ].includes(serviceCase.status);
  const planLessons = (plan?.plan_weeks ?? []).flatMap((w) =>
    (w.plan_days ?? []).flatMap((d) =>
      (d.lessons ?? []).map((l) => ({
        ...l,
        resourceLabel: `Week ${w.week_number} · Day ${d.day_number} · ${l.subject}: ${l.title}`,
      })),
    ),
  );
  const firstLesson =
    planLessons.find((item) => item.id === resourceLessonId) ??
    planLessons[0] ??
    null;
  const substituteResources = planLessons
    .flatMap((item) => item.resources ?? [])
    .filter((item) => item.requirement === "substitute");
  const caseDeliveries = deliveries.filter(
    (item) => item.case_id === serviceCase.id,
  );
  const resourceLessonChooser =
    firstLesson && ["draft", "internal_review"].includes(plan.status) ? (
      <section className="resource-target">
        <h4>Resource lesson</h4>
        <p>Choose the exact lesson this governed resource supports.</p>
        <label>
          Target lesson
          <select
            value={firstLesson.id}
            onChange={(event) => setResourceLessonId(event.target.value)}
          >
            {planLessons.map((item) => (
              <option key={item.id} value={item.id}>
                {item.resourceLabel}
              </option>
            ))}
          </select>
        </label>
      </section>
    ) : null;
  return (
    <div className="staff-authoring">
      {editable ? (
        <section className="draft-recovery" aria-label="Plan draft recovery">
          {recovered ? (
            <p className="live-operation success" role="status">
              Recovered this case’s unsaved draft from this browser session.
            </p>
          ) : null}
          {draftState !== "clean" ? (
            <p className="draft-status" role="status">
              Unsaved work protected in this browser session ·{" "}
              {draftState === "changed" ? "saving…" : "saved"}
            </p>
          ) : null}
          <div className="service-actions">
            {plan ? (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (
                    globalThis.confirm?.(
                      "Replace the current unsaved draft with the latest saved plan?",
                    )
                  )
                    updateWeeks(() => planToAuthoringWeeks(plan));
                }}
              >
                Clone latest plan
              </button>
            ) : null}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                if (
                  globalThis.confirm?.("Discard this case’s unsaved draft?")
                ) {
                  discardStaffDraft(globalThis.sessionStorage, draftKey);
                  setWeeks([week(1)]);
                  setDraftState("clean");
                }
              }}
            >
              Discard draft
            </button>
          </div>
        </section>
      ) : null}
      {editable ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const saved = await act("Plan version", () =>
              repository.createStaffPlanVersion({
                householdId,
                caseId: serviceCase.id,
                document: document(),
              }),
            );
            if (saved) {
              discardStaffDraft(globalThis.sessionStorage, draftKey);
              setDraftState("clean");
            }
          }}
        >
          <h4>Create immutable plan version</h4>
          <p>
            Build the complete schedule here. Saving creates a new version; it
            never overwrites the prior plan.
          </p>
          {weeks.map((w, wi) => (
            <fieldset key={wi}>
              <legend>Week {wi + 1}</legend>
              <label>
                Theme
                <input
                  required
                  maxLength="200"
                  value={w.theme}
                  onChange={(e) => updateWeek(wi, "theme", e.target.value)}
                />
              </label>
              {w.days.map((d, di) => (
                <fieldset key={di}>
                  <legend>Day {di + 1}</legend>
                  <label>
                    Planned date <span>(optional)</span>
                    <input
                      type="date"
                      value={d.plannedDate}
                      onChange={(e) =>
                        updateDay(wi, di, "plannedDate", e.target.value)
                      }
                    />
                  </label>
                  {d.lessons.map((l, li) => (
                    <div className="author-lesson" key={li}>
                      <strong>Lesson {li + 1}</strong>
                      <label>
                        Subject
                        <input
                          required
                          maxLength="100"
                          value={l.subject}
                          onChange={(e) =>
                            updateLesson(wi, di, li, "subject", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Title
                        <input
                          required
                          maxLength="200"
                          value={l.title}
                          onChange={(e) =>
                            updateLesson(wi, di, li, "title", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Objective
                        <textarea
                          required
                          maxLength="1000"
                          value={l.objective}
                          onChange={(e) =>
                            updateLesson(
                              wi,
                              di,
                              li,
                              "objective",
                              e.target.value,
                            )
                          }
                        />
                      </label>
                      <label>
                        Instructions <span>(one per line)</span>
                        <textarea
                          required
                          value={l.instructions}
                          onChange={(e) =>
                            updateLesson(
                              wi,
                              di,
                              li,
                              "instructions",
                              e.target.value,
                            )
                          }
                        />
                      </label>
                      <label>
                        Materials <span>(one per line)</span>
                        <textarea
                          value={l.materials}
                          onChange={(e) =>
                            updateLesson(
                              wi,
                              di,
                              li,
                              "materials",
                              e.target.value,
                            )
                          }
                        />
                      </label>
                      <label>
                        Accommodations <span>(one per line)</span>
                        <textarea
                          value={l.accommodations}
                          onChange={(e) =>
                            updateLesson(
                              wi,
                              di,
                              li,
                              "accommodations",
                              e.target.value,
                            )
                          }
                        />
                      </label>
                      <label>
                        Adult help minutes
                        <input
                          type="number"
                          min="0"
                          max="480"
                          value={l.adultHelpMinutes}
                          onChange={(e) =>
                            updateLesson(
                              wi,
                              di,
                              li,
                              "adultHelpMinutes",
                              e.target.value,
                            )
                          }
                        />
                      </label>
                      {d.lessons.length > 1 ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            updateDay(
                              wi,
                              di,
                              "lessons",
                              d.lessons.filter((_, index) => index !== li),
                            )
                          }
                        >
                          Remove lesson {li + 1}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      updateDay(wi, di, "lessons", [...d.lessons, lesson()])
                    }
                  >
                    Add lesson
                  </button>
                  {w.days.length > 1 ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        updateWeek(
                          wi,
                          "days",
                          w.days.filter((_, index) => index !== di),
                        )
                      }
                    >
                      Remove day {di + 1}
                    </button>
                  ) : null}
                </fieldset>
              ))}
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  updateWeek(wi, "days", [...w.days, day(w.days.length + 1)])
                }
              >
                Add day
              </button>
              {weeks.length > 1 ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    updateWeeks((all) => all.filter((_, index) => index !== wi))
                  }
                >
                  Remove week {wi + 1}
                </button>
              ) : null}
            </fieldset>
          ))}
          <div className="service-actions">
            <button
              type="button"
              className="ghost"
              onClick={() =>
                updateWeeks((all) => [...all, week(all.length + 1)])
              }
            >
              Add week
            </button>
            <button className="primary">Save new plan version</button>
          </div>
        </form>
      ) : null}
      {resourceLessonChooser}
      {firstLesson && ["draft", "internal_review"].includes(plan.status) ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const timestamp = resource.reviewed
              ? new Date().toISOString()
              : null;
            act("Resource", () =>
              repository.addStaffPlanResource({
                householdId,
                planId: plan.id,
                lessonId: firstLesson.id,
                resource: {
                  ...resource,
                  estimatedCostCents:
                    resource.estimatedCostCents === ""
                      ? null
                      : Number(resource.estimatedCostCents),
                  privacyReviewedAt: resource.url ? timestamp : null,
                  rightsReviewedAt: timestamp,
                  linkCheckedAt: resource.url ? timestamp : null,
                },
              }),
            );
          }}
        >
          <h4>Add governed resource</h4>
          <p>
            This resource is attached to the selected lesson. Publication
            remains blocked until required governance evidence exists.
          </p>
          <label>
            Title
            <input
              required
              maxLength="200"
              value={resource.title}
              onChange={(e) =>
                setResource((v) => ({ ...v, title: e.target.value }))
              }
            />
          </label>
          <label>
            HTTPS URL <span>(optional)</span>
            <input
              type="url"
              value={resource.url}
              onChange={(e) =>
                setResource((v) => ({ ...v, url: e.target.value }))
              }
            />
          </label>
          <label>
            Requirement
            <select
              value={resource.requirement}
              onChange={(e) =>
                setResource((v) => ({ ...v, requirement: e.target.value }))
              }
            >
              <option value="optional">Optional</option>
              <option value="required">Required</option>
              <option value="substitute">Substitute</option>
            </select>
          </label>
          <label>
            Access
            <select
              value={resource.accessType}
              onChange={(e) =>
                setResource((v) => ({ ...v, accessType: e.target.value }))
              }
            >
              <option value="free">Free</option>
              <option value="library">Library</option>
              <option value="household">Already in household</option>
              <option value="paid">Paid</option>
            </select>
          </label>
          {resource.accessType === "paid" ? (
            <label>
              Estimated cost in cents
              <input
                type="number"
                required
                min="0"
                max="1000000"
                value={resource.estimatedCostCents}
                onChange={(e) =>
                  setResource((v) => ({
                    ...v,
                    estimatedCostCents: e.target.value,
                  }))
                }
              />
            </label>
          ) : null}
          {resource.requirement === "required" ? (
            substituteResources.length ? (
              <label>
                Substitute resource
                <select
                  required
                  value={resource.substituteResourceId}
                  onChange={(e) =>
                    setResource((value) => ({
                      ...value,
                      substituteResourceId: e.target.value,
                    }))
                  }
                >
                  <option value="">Choose an available substitute</option>
                  {substituteResources.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p role="alert">
                Add and review a substitute resource before marking another
                resource as required.
              </p>
            )
          ) : null}
          <label>
            Region
            <input
              required
              maxLength="120"
              value={resource.region}
              onChange={(e) =>
                setResource((v) => ({ ...v, region: e.target.value }))
              }
            />
          </label>
          <label>
            Rights/attribution
            <input
              required
              maxLength="500"
              value={resource.attribution}
              onChange={(e) =>
                setResource((v) => ({ ...v, attribution: e.target.value }))
              }
            />
          </label>
          <label className="service-confirm">
            <input
              type="checkbox"
              checked={resource.reviewed}
              onChange={(e) =>
                setResource((v) => ({ ...v, reviewed: e.target.checked }))
              }
            />
            I checked the link (if present), privacy, rights, attribution, and
            Canadian availability.
          </label>
          <button
            className="primary"
            disabled={
              !resource.reviewed ||
              (resource.requirement === "required" &&
                !resource.substituteResourceId)
            }
          >
            Add reviewed resource
          </button>
        </form>
      ) : null}
      {["published", "revised"].includes(serviceCase.status) ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            act("Secure delivery", () =>
              repository.recordStaffDelivery({
                householdId,
                caseId: serviceCase.id,
                channel: "secure_portal",
              }),
            );
          }}
        >
          <h4>Deliver latest published plan</h4>
          <p>
            Creates a new portal delivery record and moves the case to
            delivered. Parents acknowledge it separately.
          </p>
          <button className="primary">Send secure portal delivery</button>
        </form>
      ) : null}
      {caseDeliveries.length ? (
        <section className="delivery-operations">
          <h4>Delivery history</h4>
          {caseDeliveries.map((item) => (
            <article key={item.id}>
              <span>
                Version {item.plan_version} · {item.status} · attempt{" "}
                {item.attempt_count}
              </span>
              {["failed", "bounced"].includes(item.status) ? (
                <button
                  className="ghost"
                  onClick={() =>
                    act("Delivery retry", () =>
                      repository.retryStaffDelivery({
                        householdId,
                        deliveryId: item.id,
                      }),
                    )
                  }
                >
                  Retry delivery
                </button>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
