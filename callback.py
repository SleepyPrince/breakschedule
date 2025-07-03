from ortools.sat.python import cp_model
from threading import Timer, Lock


class ObjectiveEarlyStopping(cp_model.CpSolverSolutionCallback):
    def __init__(
        self,
        timer_limit: int,
        target_ratio: int,
        acive_solvers: dict[str, any],
        solver_id: str,
        solver_lock: Lock,
    ):
        super(ObjectiveEarlyStopping, self).__init__()
        self._timer_limit = timer_limit
        self._timer = None
        self._counter = 0
        self._previous_length = 0
        self._current_gap = 0
        self._current_ratio = 0
        self._target_ratio = target_ratio
        self._active_solvers = acive_solvers
        self._solver_lock = solver_lock
        self._solver_id = solver_id
        self._interrupted = False

    def on_solution_callback(self):
        self._current_gap = abs(self.objective_value - self.best_objective_bound)
        self._current_ratio = self._current_gap / max(1, self.best_objective_bound)

        if self._interrupted or self._current_ratio <= self._target_ratio:
            self.StopSearch()
            return

        with self._solver_lock:
            if self._solver_id in self._active_solvers:
                self._active_solvers[self._solver_id]["status"] = "solving"
                self._active_solvers[self._solver_id]["progress"] = round(
                    max(
                        (0.1 - self._current_ratio) / (0.1 - self._target_ratio) * 100,
                        0,
                    ),
                    2,
                )

        self._counter += 1
        self._active_solvers[self._solver_id]["count"] = self._counter
        self._reset_timer()

    def _reset_timer(self):
        self.clear_timer()
        self._timer = Timer(self._timer_limit, self.StopSearch)
        self._timer.start()

    def clear_timer(self):
        if self._timer:
            self._timer.cancel()

    def StopSearch(self):
        self.clear_timer()

        with self._solver_lock:
            if self._solver_id in self._active_solvers:
                if self._interrupted:
                    self._active_solvers[self._solver_id]["status"] = "interrupted"
                    self._active_solvers[self._solver_id]["progress"] = 0
                else:
                    self._active_solvers[self._solver_id]["status"] = "completed"
                    self._active_solvers[self._solver_id]["progress"] = 100

        super().StopSearch()

    def is_interrupted(self):
        return self._interrupted

    def InterruptSearch(self):
        self.clear_timer()
        self._interrupted = True
        super().StopSearch()

    def current_ratio(self):
        return self._current_ratio
