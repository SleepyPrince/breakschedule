from ortools.sat.python import cp_model
import json


def negated_bounded_span(
    works: list[cp_model.BoolVarT], start: int, length: int
) -> list[cp_model.BoolVarT]:
    """Filters an isolated sub-sequence of variables assined to True.

    Extract the span of Boolean variables [start, start + length), negate them,
    and if there is variables to the left/right of this span, surround the span by
    them in non negated form.

    Args:
      works: a list of variables to extract the span from.
      start: the start to the span.
      length: the length of the span.

    Returns:
      a list of variables which conjunction will be false if the sub-list is
      assigned to True, and correctly bounded by variables assigned to False,
      or by the start or end of works.
    """
    sequence = []
    # left border (start of works, or works[start - 1])
    if start > 0:
        sequence.append(works[start - 1])
    for i in range(length):
        sequence.append(~works[start + i])
    # right border (end of works or works[start + length])
    if start + length < len(works):
        sequence.append(works[start + length])
    return sequence


def bounded_span(
    model: cp_model.CpModel, works: list[cp_model.BoolVarT], length: int
) -> list[cp_model.BoolVarT]:
    span_worked = []
    for i in range(len(works) - length + 1):
        # Create a Boolean variable to represent whether this span is fully worked
        span_var = model.new_bool_var(f"")
        span = works[i : i + length]

        # Ensure that if span_var is True, all shifts in the span are worked
        model.add(sum(span) >= length).only_enforce_if(span_var)

        # Add the span_var to the list
        span_worked.append(span_var)

    return span_worked


def add_soft_sequence_constraint(
    model: cp_model.CpModel,
    works: list[cp_model.BoolVarT],
    hard_min: int,
    soft_min: int,
    min_cost: int,
    soft_max: int,
    hard_max: int,
    max_cost: int,
    prefix: dict,
) -> tuple[list[cp_model.BoolVarT], list[int]]:
    """Sequence constraint on true variables with soft and hard bounds.

    This constraint look at every maximal contiguous sequence of variables
    assigned to true. If forbids sequence of length < hard_min or > hard_max.
    Then it creates penalty terms if the length is < soft_min or > soft_max.

    Args:
      model: the sequence constraint is built on this model.
      works: a list of Boolean variables.
      hard_min: any sequence of true variables must have a length of at least
        hard_min.
      soft_min: any sequence should have a length of at least soft_min, or a
        linear penalty on the delta will be added to the objective.
      min_cost: the coefficient of the linear penalty if the length is less than
        soft_min.
      soft_max: any sequence should have a length of at most soft_max, or a linear
        penalty on the delta will be added to the objective.
      hard_max: any sequence of true variables must have a length of at most
        hard_max.
      max_cost: the coefficient of the linear penalty if the length is more than
        soft_max.
      prefix: a base name for penalty literals.

    Returns:
      a tuple (variables_list, coefficient_list) containing the different
      penalties created by the sequence constraint.
    """
    cost_literals = []
    cost_coefficients = []

    # Forbid sequences that are too short.
    if hard_min > 0:
        for length in range(1, hard_min):
            for start in range(len(works) - length + 1):
                model.add_bool_or(negated_bounded_span(works, start, length))

    # Penalize sequences that are below the soft limit.
    if min_cost > 0:
        for length in range(hard_min, soft_min):
            for start in range(len(works) - length + 1):
                span = negated_bounded_span(works, start, length)
                prefix["violation"] = f"under_span(start={start}, length={length})"
                # name = f": under_span(start={start}, length={length})"
                lit = model.new_bool_var(json.dumps(prefix))
                span.append(lit)
                model.add_bool_or(span)
                cost_literals.append(lit)
                # We filter exactly the sequence with a short length.
                # The penalty is proportional to the delta with soft_min.
                cost_coefficients.append(min_cost * (soft_min - length))

    # Penalize sequences that are above the soft limit.
    if max_cost > 0:
        for length in range(soft_max + 1, hard_max + 1):
            for start in range(len(works) - length + 1):
                span = negated_bounded_span(works, start, length)
                prefix["violation"] = f"over_span(start={start}, length={length})"
                # name = f": over_span(start={start}, length={length})"
                lit = model.new_bool_var(json.dumps(prefix))
                span.append(lit)
                model.add_bool_or(span)
                cost_literals.append(lit)
                # Cost paid is max_cost * excess length.
                cost_coefficients.append(max_cost * (length - soft_max))

    # Just forbid any sequence of true variables with length hard_max + 1
    if hard_max > 0:
        for start in range(len(works) - hard_max):
            model.add_bool_or([~works[i] for i in range(start, start + hard_max + 1)])

    return cost_literals, cost_coefficients


def add_rev_soft_sequence_constraint(
    model: cp_model.CpModel,
    works: list[cp_model.BoolVarT],
    hard_max: int,
) -> tuple[list[cp_model.BoolVarT], list[int]]:
    # todo documentation
    cost_literals = []
    cost_coefficients = []

    # Just forbid any sequence of false variables with length hard_max + 1
    for start in range(len(works) - hard_max):
        model.add_bool_or([works[i] for i in range(start, start + hard_max + 1)])
    return cost_literals, cost_coefficients


def add_soft_sum_constraint(
    model: cp_model.CpModel,
    works: list[cp_model.BoolVarT],
    hard_min: int,
    soft_min: int,
    min_cost: int,
    soft_max: int,
    hard_max: int,
    max_cost: int,
    max_val: int,
    prefix: dict,
) -> tuple[list[cp_model.IntVar], list[int]]:
    """sum constraint with soft and hard bounds.

    This constraint counts the variables assigned to true from works.
    If forbids sum < hard_min or > hard_max.
    Then it creates penalty terms if the sum is < soft_min or > soft_max.

    Args:
      model: the sequence constraint is built on this model.
      works: a list of Boolean variables.
      hard_min: any sequence of true variables must have a sum of at least
        hard_min.
      soft_min: any sequence should have a sum of at least soft_min, or a linear
        penalty on the delta will be added to the objective.
      min_cost: the coefficient of the linear penalty if the sum is less than
        soft_min.
      soft_max: any sequence should have a sum of at most soft_max, or a linear
        penalty on the delta will be added to the objective.
      hard_max: any sequence of true variables must have a sum of at most
        hard_max.
      max_cost: the coefficient of the linear penalty if the sum is more than
        soft_max.
      prefix: a base name for penalty variables.

    Returns:
      a tuple (variables_list, coefficient_list) containing the different
      penalties created by the sequence constraint.
    """
    cost_variables = []
    cost_coefficients = []
    if hard_max == 0 or max_cost == 0:
        sum_var = model.new_int_var(hard_min, len(works), "")
    else:
        sum_var = model.new_int_var(hard_min, hard_max, "")

    # This adds the hard constraints on the sum.
    model.add(sum_var == sum(works))

    # Penalize sums below the soft_min target.
    if soft_min > hard_min and min_cost > 0:
        delta = model.new_int_var(-len(works), len(works), "")
        model.add(delta == soft_min - sum_var)
        # TODO(user): Compare efficiency with only excess >= soft_min - sum_var.
        prefix["violation"] = f"under_sum"
        excess = model.new_int_var(0, max_val, json.dumps(prefix))
        # excess = model.new_int_var(0, max_val, prefix + ": under_sum")
        model.add(excess >= soft_min - sum_var)
        model.add_max_equality(excess, [delta, 0])
        cost_variables.append(excess)
        cost_coefficients.append(min_cost)

    # Penalize sums above the soft_max target.
    if soft_max < hard_max and max_cost > 0:
        delta = model.new_int_var(-max_val, max_val, "")
        model.add(delta == sum_var - soft_max)
        prefix["violation"] = f"over_sum"
        excess = model.new_int_var(0, max_val, json.dumps(prefix))
        # excess = model.new_int_var(0, max_val, prefix + ": over_sum")
        model.add_max_equality(excess, [delta, 0])
        cost_variables.append(excess)
        cost_coefficients.append(max_cost)

    return cost_variables, cost_coefficients


def add_one_set_constraint(
    model: cp_model.CpModel,
    works: list[cp_model.BoolVarT],
    hard_min: int,
    soft_min: int,
    min_cost: int,
    prefix: dict,
) -> tuple[list[cp_model.BoolVarT], list[int]]:
    """
    Adds a constraint to ensure that there is at least one group of `soft_min` consecutive shifts.
    If the constraint is not met, a penalty is applied.

    :param model: The CP-SAT model.
    :param works: List of Boolean variables representing shifts.
    :param hard_min: Minimum number of shifts that must be worked (hard constraint).
    :param soft_min: Desired number of consecutive shifts (soft constraint).
    :param min_cost: Penalty cost if the soft constraint is violated.
    :param prefix: Prefix for naming variables.
    :return: A tuple of (cost_literals, cost_coefficients) for penalties.
    """
    cost_literals = []
    cost_coefficients = []

    # Ensure soft_min is valid
    if soft_min > len(works):
        raise ValueError("soft_min cannot be greater than the number of shifts.")

    # Add hard constraint: at least hard_min shifts must be worked
    model.add_bool_or(bounded_span(model, works, hard_min))

    if soft_min > hard_min:
        # Create a violation literal
        violation_lit = model.new_bool_var(json.dumps(prefix))

        # Create a list to track whether each span of soft_min consecutive shifts is worked
        span_worked = bounded_span(model, works, soft_min)
        span_worked.append(violation_lit)

        # Ensure that at least one span is worked, or the violation_lit is True
        model.add_bool_or(span_worked)

        # Add penalty for violating the soft constraint
        cost_literals.append(violation_lit)
        cost_coefficients.append(min_cost)

    return cost_literals, cost_coefficients
