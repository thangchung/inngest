package golang

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/inngest/inngest/pkg/consts"
	"github.com/inngest/inngest/pkg/coreapi/graph/models"
	"github.com/inngest/inngest/pkg/event"
	"github.com/inngest/inngest/tests/client"
	"github.com/inngest/inngestgo"
	"github.com/inngest/inngestgo/step"
	"github.com/oklog/ulid/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInvoke(t *testing.T) {
	ctx := context.Background()
	r := require.New(t)
	c := client.New(t)

	appID := "Invoke-" + ulid.MustNew(ulid.Now(), nil).String()
	h, server, registerFuncs := NewSDKHandler(t, appID)
	defer server.Close()

	invokedFnName := "invoked-fn"
	invokedFn := inngestgo.CreateFunction(
		inngestgo.FunctionOpts{
			Name:    invokedFnName,
			Retries: inngestgo.IntPtr(0),
		},
		inngestgo.EventTrigger("none", nil),
		func(ctx context.Context, input inngestgo.Input[DebounceEvent]) (any, error) {
			return "invoked!", nil
		},
	)

	// This function will invoke the other function
	runID := ""
	evtName := "invoke-me"
	mainFn := inngestgo.CreateFunction(
		inngestgo.FunctionOpts{
			Name: "main-fn",
		},
		inngestgo.EventTrigger(evtName, nil),
		func(ctx context.Context, input inngestgo.Input[DebounceEvent]) (any, error) {
			runID = input.InputCtx.RunID

			_, _ = step.Invoke[any](
				ctx,
				"invoke",
				step.InvokeOpts{FunctionId: appID + "-" + invokedFnName},
			)

			return "success", nil
		},
	)

	h.Register(invokedFn, mainFn)
	registerFuncs()

	// Trigger the main function and successfully invoke the other function
	_, err := inngestgo.Send(ctx, &event.Event{Name: evtName})
	r.NoError(err)

	t.Run("trace run should have appropriate data", func(t *testing.T) {
		<-time.After(3 * time.Second)

		require.Eventually(t, func() bool {
			run := c.RunTraces(ctx, runID)
			require.NotNil(t, run)
			require.Equal(t, models.FunctionStatusCompleted.String(), run.Status)
			require.NotNil(t, run.Trace)
			require.Equal(t, 1, len(run.Trace.ChildSpans))
			require.True(t, run.Trace.IsRoot)
			require.Equal(t, models.RunTraceSpanStatusCompleted.String(), run.Trace.Status)

			// output test
			require.NotNil(t, run.Trace.OutputID)
			output := c.RunSpanOutput(ctx, *run.Trace.OutputID)
			c.ExpectSpanOutput(t, "success", output)

			rootSpanID := run.Trace.SpanID

			t.Run("invoke", func(t *testing.T) {
				invoke := run.Trace.ChildSpans[0]
				assert.Equal(t, "invoke", invoke.Name)
				assert.Equal(t, 0, invoke.Attempts)
				assert.Equal(t, 0, len(invoke.ChildSpans))
				assert.False(t, invoke.IsRoot)
				assert.Equal(t, rootSpanID, invoke.ParentSpanID)
				assert.Equal(t, models.StepOpInvoke.String(), invoke.StepOp)

				// output test
				assert.NotNil(t, invoke.OutputID)
				invokeOutput := c.RunSpanOutput(ctx, *invoke.OutputID)
				c.ExpectSpanOutput(t, "invoked!", invokeOutput)

				var stepInfo models.InvokeStepInfo
				byt, err := json.Marshal(invoke.StepInfo)
				assert.NoError(t, err)
				assert.NoError(t, json.Unmarshal(byt, &stepInfo))

				assert.False(t, *stepInfo.TimedOut)
				assert.NotNil(t, stepInfo.ReturnEventID)
				assert.NotNil(t, stepInfo.RunID)
			})

			return true
		}, 10*time.Second, 2*time.Second)
	})
}

func TestInvokeGroup(t *testing.T) {
	ctx := context.Background()
	r := require.New(t)
	c := client.New(t)

	appID := "InvokeGroup-" + ulid.MustNew(ulid.Now(), nil).String()
	h, server, registerFuncs := NewSDKHandler(t, appID)
	defer server.Close()

	invokedFnName := "invoked-fn"
	invokedFn := inngestgo.CreateFunction(
		inngestgo.FunctionOpts{
			Name:    invokedFnName,
			Retries: inngestgo.IntPtr(0),
		},
		inngestgo.EventTrigger("none", nil),
		func(ctx context.Context, input inngestgo.Input[DebounceEvent]) (any, error) {
			return "invoked!", nil
		},
	)
	var (
		started int32
		runID   string
	)

	// This function will invoke the other function
	evtName := "invoke-group-me"
	mainFn := inngestgo.CreateFunction(
		inngestgo.FunctionOpts{
			Name: "main-fn",
		},
		inngestgo.EventTrigger(evtName, nil),
		func(ctx context.Context, input inngestgo.Input[DebounceEvent]) (any, error) {
			runID = input.InputCtx.RunID

			if atomic.LoadInt32(&started) == 0 {
				atomic.AddInt32(&started, 1)
				return nil, inngestgo.RetryAtError(fmt.Errorf("initial error"), time.Now().Add(5*time.Second))
			}

			_, _ = step.Invoke[any](
				ctx,
				"invoke",
				step.InvokeOpts{FunctionId: appID + "-" + invokedFnName},
			)

			return "success", nil
		},
	)

	h.Register(invokedFn, mainFn)
	registerFuncs()

	// Trigger the main function and successfully invoke the other function
	_, err := inngestgo.Send(ctx, &event.Event{Name: evtName})
	r.NoError(err)

	t.Run("in progress", func(t *testing.T) {
		<-time.After(3 * time.Second)

		require.Eventually(t, func() bool {
			run := c.RunTraces(ctx, runID)
			require.Nil(t, run.EndedAt)
			require.Nil(t, run.Trace.EndedAt)
			require.NotNil(t, models.FunctionStatusRunning.String(), run.Status)
			require.NotNil(t, run.Trace)
			require.Equal(t, 1, len(run.Trace.ChildSpans))
			require.Equal(t, models.RunTraceSpanStatusRunning.String(), run.Trace.Status)
			require.Nil(t, run.Trace.OutputID)

			rootSpanID := run.Trace.SpanID

			span := run.Trace.ChildSpans[0]
			assert.Equal(t, consts.OtelExecPlaceholder, span.Name)
			assert.Equal(t, 0, span.Attempts)
			assert.Equal(t, rootSpanID, span.ParentSpanID)
			assert.False(t, span.IsRoot)
			assert.Equal(t, 2, len(span.ChildSpans)) // include queued retry span
			assert.Equal(t, models.RunTraceSpanStatusRunning.String(), span.Status)
			assert.Equal(t, "", span.StepOp)
			assert.Nil(t, span.OutputID)

			t.Run("failed", func(t *testing.T) {
				exec := span.ChildSpans[0]
				assert.Equal(t, "Attempt 0", exec.Name)
				assert.Equal(t, models.RunTraceSpanStatusFailed.String(), exec.Status)
				assert.NotNil(t, exec.OutputID)

				execOutput := c.RunSpanOutput(ctx, *exec.OutputID)
				assert.NotNil(t, execOutput)
				c.ExpectSpanErrorOutput(t, "", "initial error", execOutput)
			})

			return true
		}, 10*time.Second, 2*time.Second)
	})

	t.Run("trace run should have appropriate data", func(t *testing.T) {
		<-time.After(3 * time.Second)

		require.Eventually(t, func() bool {
			run := c.RunTraces(ctx, runID)
			require.NotNil(t, run)
			require.Equal(t, models.FunctionStatusCompleted.String(), run.Status)
			require.NotNil(t, run.Trace)
			require.Equal(t, 1, len(run.Trace.ChildSpans))
			require.True(t, run.Trace.IsRoot)
			require.Equal(t, models.RunTraceSpanStatusCompleted.String(), run.Trace.Status)

			// output test
			require.NotNil(t, run.Trace.OutputID)
			output := c.RunSpanOutput(ctx, *run.Trace.OutputID)
			c.ExpectSpanOutput(t, "success", output)

			rootSpanID := run.Trace.SpanID

			t.Run("invoke", func(t *testing.T) {
				invoke := run.Trace.ChildSpans[0]
				assert.Equal(t, "invoke", invoke.Name)
				assert.Equal(t, 0, invoke.Attempts)
				assert.False(t, invoke.IsRoot)
				assert.Equal(t, rootSpanID, invoke.ParentSpanID)
				assert.Equal(t, 2, len(invoke.ChildSpans))
				assert.Equal(t, models.StepOpInvoke.String(), invoke.StepOp)
				assert.NotNil(t, invoke.EndedAt)

				// output test
				assert.NotNil(t, invoke.OutputID)
				invokeOutput := c.RunSpanOutput(ctx, *invoke.OutputID)
				c.ExpectSpanOutput(t, "invoked!", invokeOutput)

				var stepInfo models.InvokeStepInfo
				byt, err := json.Marshal(invoke.StepInfo)
				assert.NoError(t, err)
				assert.NoError(t, json.Unmarshal(byt, &stepInfo))

				assert.False(t, *stepInfo.TimedOut)
				assert.NotNil(t, stepInfo.ReturnEventID)
				assert.NotNil(t, stepInfo.RunID)
			})

			return true
		}, 10*time.Second, 2*time.Second)
	})
}

func TestInvokeTimeout(t *testing.T) {
	ctx := context.Background()
	r := require.New(t)
	c := client.New(t)

	appID := "InvokeTimeout-" + ulid.MustNew(ulid.Now(), nil).String()
	h, server, registerFuncs := NewSDKHandler(t, appID)
	defer server.Close()

	invokedFnName := "invoked-fn"
	invokedFn := inngestgo.CreateFunction(
		inngestgo.FunctionOpts{
			Name:    invokedFnName,
			Retries: inngestgo.IntPtr(0),
		},
		inngestgo.EventTrigger("none", nil),
		func(ctx context.Context, input inngestgo.Input[DebounceEvent]) (any, error) {
			step.Sleep(ctx, "sleep", 5*time.Second)

			return nil, nil
		},
	)

	// This function will invoke the other function
	runID := ""
	evtName := "my-event"
	mainFn := inngestgo.CreateFunction(
		inngestgo.FunctionOpts{
			Name: "main-fn",
		},
		inngestgo.EventTrigger(evtName, nil),
		func(ctx context.Context, input inngestgo.Input[DebounceEvent]) (any, error) {
			runID = input.InputCtx.RunID

			_, _ = step.Invoke[any](
				ctx,
				"invoke",
				step.InvokeOpts{FunctionId: appID + "-" + invokedFnName, Timeout: 1 * time.Second},
			)

			return nil, nil
		},
	)

	h.Register(invokedFn, mainFn)
	registerFuncs()

	// Trigger the main function and successfully invoke the other function
	_, err := inngestgo.Send(ctx, &event.Event{Name: evtName})
	r.NoError(err)

	// The invoke target times out and should fail the main run
	c.WaitForRunStatus(ctx, t, "FAILED", &runID)

	t.Run("trace run should have appropriate data", func(t *testing.T) {
		<-time.After(3 * time.Second)
		errMsg := "Timed out waiting for invoked function to complete"

		require.Eventually(t, func() bool {
			run := c.RunTraces(ctx, runID)
			require.NotNil(t, run)
			require.Equal(t, models.FunctionStatusFailed.String(), run.Status)
			require.NotNil(t, run.Trace)
			require.True(t, run.Trace.IsRoot)
			require.Equal(t, models.RunTraceSpanStatusFailed.String(), run.Trace.Status)

			// output test
			require.NotNil(t, run.Trace.OutputID)
			output := c.RunSpanOutput(ctx, *run.Trace.OutputID)
			require.NotNil(t, output)
			// c.ExpectSpanErrorOutput(t, errMsg, "", output)

			rootSpanID := run.Trace.SpanID

			t.Run("invoke", func(t *testing.T) {
				invoke := run.Trace.ChildSpans[0]
				assert.Equal(t, "invoke", invoke.Name)
				assert.Equal(t, 0, invoke.Attempts)
				assert.False(t, invoke.IsRoot)
				assert.Equal(t, rootSpanID, invoke.ParentSpanID)
				assert.Equal(t, models.StepOpInvoke.String(), invoke.StepOp)
				assert.NotNil(t, invoke.EndedAt)

				// output test
				assert.NotNil(t, invoke.OutputID)
				invokeOutput := c.RunSpanOutput(ctx, *invoke.OutputID)
				c.ExpectSpanErrorOutput(t, errMsg, "", invokeOutput)

				var stepInfo models.InvokeStepInfo
				byt, err := json.Marshal(invoke.StepInfo)
				assert.NoError(t, err)
				assert.NoError(t, json.Unmarshal(byt, &stepInfo))

				assert.True(t, *stepInfo.TimedOut)
				assert.Nil(t, stepInfo.ReturnEventID)
				assert.Nil(t, stepInfo.RunID)
			})

			return true
		}, 10*time.Second, 2*time.Second)
	})
}

func TestInvokeRateLimit(t *testing.T) {
	ctx := context.Background()
	r := require.New(t)
	c := client.New(t)

	appID := "InvokeRateLimit-" + ulid.MustNew(ulid.Now(), nil).String()
	h, server, registerFuncs := NewSDKHandler(t, appID)
	defer server.Close()

	// This function will be invoked by the main function
	invokedFnName := "invoked-fn"
	invokedFn := inngestgo.CreateFunction(
		inngestgo.FunctionOpts{
			Name: invokedFnName,
			RateLimit: &inngestgo.RateLimit{
				Limit:  1,
				Period: 1 * time.Minute,
			},
			Retries: inngestgo.IntPtr(0),
		},
		inngestgo.EventTrigger("none", nil),
		func(ctx context.Context, input inngestgo.Input[DebounceEvent]) (any, error) {
			return nil, nil
		},
	)

	// This function will invoke the other function
	runID := ""
	evtName := "my-event"
	mainFn := inngestgo.CreateFunction(
		inngestgo.FunctionOpts{
			Name: "main-fn",
		},
		inngestgo.EventTrigger(evtName, nil),
		func(ctx context.Context, input inngestgo.Input[DebounceEvent]) (any, error) {
			runID = input.InputCtx.RunID

			_, _ = step.Invoke[any](
				ctx,
				"invoke",
				step.InvokeOpts{FunctionId: appID + "-" + invokedFnName})

			return nil, nil
		},
	)

	h.Register(invokedFn, mainFn)
	registerFuncs()

	// Trigger the main function and successfully invoke the other function
	_, err := inngestgo.Send(ctx, &event.Event{Name: evtName})
	r.NoError(err)
	c.WaitForRunStatus(ctx, t, "COMPLETED", &runID)

	// Trigger the main function. It'll fail because the invoked function is
	// rate limited
	runID = ""
	_, err = inngestgo.Send(ctx, &event.Event{Name: evtName})
	r.NoError(err)
	c.WaitForRunStatus(ctx, t, "FAILED", &runID)
}
