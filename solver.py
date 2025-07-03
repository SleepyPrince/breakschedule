import math
import os
from threading import Lock

from constraints import (
    add_soft_sequence_constraint,
    add_soft_sum_constraint,
    add_rev_soft_sequence_constraint,
    add_one_set_constraint,
)
from util import find_in_tuple


from itertools import combinations
from ortools.sat.python import cp_model


def solve_shift_scheduling(
    data: dict[str, any],
    cb: cp_model.CpSolverSolutionCallback,
    active_solvers: dict[str, any],
    solver_id: str,
    solver_lock: Lock,
    num_workers=min(os.cpu_count(), 8),
):
    """Solves the shift scheduling problem."""
    try:
        num_employees = data.get("num_employees")

        # Manning demands for each session
        cover_demands = [tuple(item) for item in data.get("cover_demands", [])]

        num_sessions = len(cover_demands)

        positions = [""] + (data.get("positions"))
        max_continous_work = data.get("max_continous_work", 4)
        min_breaks = math.floor(num_sessions / (max_continous_work + 1))

        # Fixed assignment: (employee, position, session).
        fixed_assignments = [tuple(item) for item in data.get("fixed_assignments", [])]

        # Rating constraints: (employee, [positions]).
        rating_constraints = [
            tuple(item) for item in data.get("rating_constraints", [])
        ]

        # Preference: (employee, positions, session, weight)
        # A negative weight indicates that the employee desire this assignment.
        preference = [tuple(item) for item in data.get("preference", [])]

        # Position constraints on continuous sequence :
        #     (position, hard_min, soft_min, min_penalty,
        #             soft_max, hard_max, max_penalty)
        # default prefer 2 breaks instead of 1 (penalty)
        position_constraints = [
            tuple(item)
            for item in data.get("position_constraints", [])
            + [[0, 1, 2, 5, 4, num_sessions, 0]]
        ]

        # Consecutive constraints
        consecutive_constraints = [
            tuple(item)
            for item in data.get("constraints", {}).get("consecutive_constraints", [])
        ]

        # Sum constraints on position sessions:
        #     (position, hard_min, soft_min, min_penalty,
        #             soft_max, hard_max, max_penalty)
        sum_constraints = [
            tuple(item)
            for item in data.get("constraints", {}).get("sum_constraints", [])
        ]

        # break constraints
        # (acrossNsession, hard_min, soft_min, min_penalty)
        break_constraints = [tuple(item) for item in data.get("break_constraints", [])]

        num_positions = len(positions)

        model = cp_model.CpModel()

        work = {
            (e, p, d): model.new_bool_var(f"work{e}_{p}_{d}")
            for e in range(num_employees)
            for p in range(num_positions)
            for d in range(num_sessions)
        }

        # Linear terms of the objective in a minimization context.
        obj_int_vars: list[cp_model.IntVar] = []
        obj_int_coeffs: list[int] = []
        obj_bool_vars: list[cp_model.BoolVarT] = []
        obj_bool_coeffs: list[int] = []

        # Exactly one position per session.
        for e in range(num_employees):
            for d in range(num_sessions):
                model.add_exactly_one(work[e, p, d] for p in range(num_positions))

        # Fixed assignments.
        # if position == -1 then employee is working (break is set to false)
        for e, p, d in fixed_assignments:
            if p == -1:
                model.add(work[e, 0, d] == 0)
            else:
                model.add(work[e, p, d] == 1)

        # Rating constraints
        for r in rating_constraints:
            employee, *ratings = r
            for d in range(num_sessions):
                for p in set(range(1, num_positions)) - set(ratings):
                    model.add(work[employee, p, d] == 0)

        # Session preferences
        for e, p, d, w in preference:
            obj_bool_vars.append(work[e, p, d])
            obj_bool_coeffs.append(w)

        # Position constraints
        for ct in position_constraints:
            position, hard_min, soft_min, min_cost, soft_max, hard_max, max_cost = ct
            for e in range(num_employees):
                works = [work[e, position, d] for d in range(num_sessions)]
                variables, coeffs = add_soft_sequence_constraint(
                    model,
                    works,
                    hard_min,
                    soft_min,
                    min_cost,
                    soft_max,
                    hard_max,
                    max_cost,
                    {"name": "position_constraint", "staff": e, "position": position},
                )
                obj_bool_vars.extend(variables)
                obj_bool_coeffs.extend(coeffs)

        # Position assignment constraints (prefer 2/3 continous, 1/4 penalized)
        for e in range(num_employees):
            for position in range(1, num_positions):
                works = [work[e, position, d] for d in range(num_sessions)]
                variables, coeffs = add_soft_sequence_constraint(
                    model,
                    works,
                    1,
                    2,
                    data["weights"]["short_session"],
                    3,
                    max_continous_work,
                    data["weights"]["long_session"],
                    {"name": "position_assignment", "staff": e, "position": position},
                )
                obj_bool_vars.extend(variables)
                obj_bool_coeffs.extend(coeffs)

        # Consecutive Breaks
        for e in range(num_employees):
            works = [work[e, 0, d] for d in range(num_sessions)]
            variables, coeffs = add_soft_sequence_constraint(
                model,
                works,
                1,
                2,
                data["weights"]["short_break"],
                4,
                num_sessions,
                data["weights"]["long_break"],
                {"name": "long_breaks", "staff": e},
            )
            obj_bool_vars.extend(variables)
            obj_bool_coeffs.extend(coeffs)

        # Consecutive constraints
        for ct in consecutive_constraints:
            (
                employees,
                position,
                start,
                end,
                hard_min,
                soft_min,
                min_cost,
                soft_max,
                hard_max,
                max_cost,
                prefix,
            ) = ct
            for e in employees:
                works = [work[e, position, d] for d in range(start, end + 1)]
                variables, coeffs = add_soft_sequence_constraint(
                    model,
                    works,
                    hard_min,
                    soft_min,
                    min_cost,
                    soft_max,
                    hard_max,
                    max_cost,
                    {"name": prefix, "staff": e, "position": position},
                )
                obj_bool_vars.extend(variables)
                obj_bool_coeffs.extend(coeffs)

        # Sum constraints
        for ct in sum_constraints:
            (
                employees,
                position,
                start,
                end,
                hard_min,
                soft_min,
                min_cost,
                soft_max,
                hard_max,
                max_cost,
                prefix,
            ) = ct

            for e in employees:
                works = [work[e, position, d] for d in range(start, end + 1)]
                variables, coeffs = add_soft_sum_constraint(
                    model,
                    works,
                    hard_min,
                    soft_min,
                    min_cost,
                    soft_max,
                    hard_max,
                    max_cost,
                    num_sessions,
                    {
                        "name": prefix,
                        "staff": e,
                        "position": position,
                        "start": start,
                        "end": end,
                    },
                )
                obj_int_vars.extend(variables)
                obj_int_coeffs.extend(coeffs)

        # promote even position distribution
        for e in range(num_employees):
            # only check valid ratings
            for p in find_in_tuple(rating_constraints, e) or range(1, num_positions):
                works = [work[e, p, d] for d in range(num_sessions)]
                variables, coeffs = add_soft_sum_constraint(
                    model,
                    works,
                    0,
                    1,
                    data.get("weights", {}).get(
                        "position_evenness", 5
                    ),  # penalty for each position not assigned to employee
                    num_sessions - min_breaks,  # ? set soft_max and hard_max sessions?
                    num_sessions - min_breaks,
                    0,
                    num_sessions - min_breaks,
                    {"name": "position_evenness", "staff": e, "position": p},
                )
                obj_int_vars.extend(variables)
                obj_int_coeffs.extend(coeffs)

        # break constraints handling
        for ct in break_constraints:
            across, hard_min, soft_min, min_cost = ct
            for e in range(num_employees):
                for f in range(num_sessions - (across - 1)):
                    works = [work[e, 0, d + f] for d in range(across)]
                    variables, coeffs = add_soft_sum_constraint(
                        model,
                        works,
                        hard_min,
                        soft_min,
                        min_cost,
                        num_sessions,
                        num_sessions,
                        0,
                        num_sessions,
                        {"name": "break_constraint", "staff": e, "session": f},
                    )
                    obj_int_vars.extend(variables)
                    obj_int_coeffs.extend(coeffs)

        # max continous work constraints (hard constraint)
        for e in range(num_employees):
            works = [work[e, 0, d] for d in range(num_sessions)]
            variables, coeffs = add_rev_soft_sequence_constraint(
                model,
                works,
                max_continous_work,
            )
            obj_bool_vars.extend(variables)
            obj_bool_coeffs.extend(coeffs)

        constraints = data.get("constraints", {})

        # one set constraints
        for group in constraints.get("one_set", []):
            employees, start, end, position, hard_min, soft_min, min_cost, prefix = (
                group
            )
            for e in employees:
                works = [work[e, position, d] for d in range(start, end + 1)]
                variables, coeffs = add_one_set_constraint(
                    model,
                    works,
                    hard_min,
                    soft_min,
                    min_cost,
                    {
                        "name": prefix,
                        "staff": e,
                        "position": position,
                        "start": start,
                        "end": end,
                    },
                )
                obj_bool_vars.extend(variables)
                obj_bool_coeffs.extend(coeffs)

        # Penalized transitions
        for previous_position, next_position, cost in constraints.get("transition", []):
            for e in range(num_employees):
                for d in range(num_sessions - 1):
                    transition = [
                        ~work[e, previous_position, d],
                        ~work[e, next_position, d + 1],
                    ]
                    if cost == 0:
                        model.add_bool_or(transition)
                    else:
                        trans_var = model.new_bool_var(
                            f'{{"name": "transition", "staff": {e}, "session": {d}, "violation": "{previous_position} -> {next_position}"}}'
                        )
                        transition.append(trans_var)
                        model.add_bool_or(transition)
                        obj_bool_vars.append(trans_var)
                        obj_bool_coeffs.append(cost)

        # Cover constraints
        for p in range(1, num_positions):
            for d in range(num_sessions):
                works = [work[e, p, d] for e in range(num_employees)]
                # Ignore Break.
                min_demand = cover_demands[d][p - 1]
                model.add(min_demand == sum(works))

        # prevent loop 2 employees
        if data.get("prevent_loop_2", True):
            for e1, e2 in combinations(range(num_employees), 2):
                for s1 in range(1, num_positions):
                    for s2 in range(1, num_positions):
                        if s1 != s2:
                            for d in range(num_sessions - 1):
                                if all(
                                    cover_demands[d + i][s - 1] > 0
                                    for i in range(2)
                                    for s in (s1, s2)
                                ):
                                    model.add_bool_or(
                                        [
                                            ~work[e1, s1, d],
                                            ~work[e1, s2, d + 1],
                                            ~work[e2, s2, d],
                                            ~work[e2, s1, d + 1],
                                        ]
                                    )

        # prevent loop 3 employees
        if data.get("prevent_loop_3", True):
            for e1, e2, e3 in combinations(range(num_employees), 3):
                for s1 in range(1, num_positions):
                    for s2 in range(1, num_positions):
                        if len({s1, s2}) == 2:
                            for s3 in range(1, num_positions):
                                if len({s1, s2, s3}) == 3:
                                    for d in range(num_sessions - 1):
                                        if all(
                                            cover_demands[d + i][s - 1] > 0
                                            for i in range(2)
                                            for s in (s1, s2, s3)
                                        ):
                                            model.add_bool_or(
                                                [
                                                    ~work[e1, s1, d],
                                                    ~work[e1, s2, d + 1],
                                                    ~work[e2, s2, d],
                                                    ~work[e2, s3, d + 1],
                                                    ~work[e3, s3, d],
                                                    ~work[e3, s1, d + 1],
                                                ]
                                            )

        # Distribute breaks evenly (minimize variance)
        break_vars: list[cp_model.IntVar] = []
        for e in range(num_employees):
            breaks = [work[e, 0, d] for d in range(num_sessions)]
            employee_break = model.new_int_var(min_breaks, num_sessions, "")
            model.add(employee_break == sum(breaks))
            employee_break_sq = model.new_int_var(min_breaks**2, num_sessions**2, "")
            model.add_multiplication_equality(
                employee_break_sq, [employee_break, employee_break]
            )
            break_vars.append(employee_break_sq)

        # Objective
        model.minimize(
            sum(
                obj_bool_vars[i] * obj_bool_coeffs[i] for i in range(len(obj_bool_vars))
            )
            + sum(obj_int_vars[i] * obj_int_coeffs[i] for i in range(len(obj_int_vars)))
            + sum(break_vars) * data["weights"]["break_evenness"]
        )

        # Solve the model.
        solver = cp_model.CpSolver()

        solver.parameters.num_workers = num_workers
        solver.parameters.max_time_in_seconds = data.get("max_time", 15)
        solver.parameters.symmetry_level = 1  # or 0
        solver.parameters.cp_model_presolve = False
        # solver.parameters.ignore_subsolvers.extend(["feasibility_pump", "ls"])
        solver.parameters.use_lns = True

        cb._reset_timer()
        status = solver.solve(model, cb)
        cb.clear_timer()

        if cb.is_interrupted():
            # q.put(Message("interrupted").__str__())
            return

        if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
            # solution
            result = {
                "status": "FEASIBLE",
                "solution": solution_obj(
                    solver, work, num_positions, num_employees, num_sessions
                ),
            }
        else:
            result = {
                "status": "INFEASIBLE",
                "solution": None,
            }

        return result

        # todo return solution
        #     q.put(
        #         Message(
        #             "success",
        #             "solver",
        #             f"Done {solver.user_time:.2f}s {cb.current_ratio():.3f}",
        #             obj,
        #         ).__str__()
        #     )

        #     # penalties
        #     msg = Message("penalties", "solver", "", {"penalties": []})
        #     for i, var in enumerate(obj_bool_vars):
        #         if solver.boolean_value(var):
        #             penalty = obj_bool_coeffs[i]
        #             if penalty > 0:
        #                 try:
        #                     j = json.loads(var.name)
        #                     j["penalty"] = penalty
        #                     msg.payload["penalties"].append(j)

        #                 except:
        #                     j = f'{var.name}, "penalty": {penalty}'
        #                     msg.payload["penalties"].append(j)

        #             # todo restore with preference implementation
        #             # else:
        #             # print(f"  {var.name} fulfilled, gain={-penalty}")

        #     for i, var in enumerate(obj_int_vars):
        #         if solver.value(var) > 0:
        #             try:
        #                 j = json.loads(var.name)
        #                 j["violation"] = j["violation"] + f" {solver.value(var)}"
        #                 j["penalty"] = obj_int_coeffs[i]
        #                 msg.payload["penalties"].append(j)

        #             except:
        #                 j = (
        #                     f'{var.name} violated by {solver.value(var)}", '
        #                     f'"penalty":{obj_int_coeffs[i]}'
        #                 )
        #                 msg.payload["penalties"].append(j)

        #     # send penalties
        #     q.put(msg.__str__())

        # else:
        #     q.put(Message("error", "solver", "Not feasible", None).__str__())
    except:
        pass
        # q.put(Message("error", "solver", traceback.format_exc(), None).__str__())


def solution_obj(model, work, num_positions, num_employees, num_sessions) -> list:
    sessions = []
    for e in range(num_employees):
        staff = []
        for d in range(num_sessions):
            for p in range(num_positions):
                if model.boolean_value(work[e, p, d]):
                    staff.append(p)
        sessions.append(staff)

    return sessions
