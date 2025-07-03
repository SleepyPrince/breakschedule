class Config {
    constructor() {
        this._shift_times = [];
        this._staff = [];
        this._positions = {};
        this._constraints = [];
        this._gap_ratio = 0.002;
    }

    reset() {
        this._shift_times = [];
        this._staff = [];
        this._positions = {};
        this._constraints = [];
        this._gap_ratio = 0.002;

        const shift_select = new bootstrap.Collapse(document.getElementById("shift_select"), { toggle: false });
        shift_select.show();

        const staff_select = new bootstrap.Collapse(document.getElementById("staff_select"), { toggle: false });
        staff_select.hide();

        const position_select = new bootstrap.Collapse(document.getElementById("position_select"), { toggle: false });
        position_select.hide();

        document.querySelectorAll(`input[name="position"]`).forEach((el) => {
            el.checked = false;
        });

        document.getElementById("setup_table").innerHTML = "";
    }

    static fromJson(json) {
        const config = new Config();
        config._shift_times = json._shift_times || [];
        json._staff.forEach((staffJson) => {
            config.addStaffFromJson(staffJson);
        });

        config._positions = json._positions || {}; // todo
        config._constraints = json._constraints || [];    // todo
        config._gap_ratio = json._gap_ratio || 0.002;

        return config;
    }

    get shift_times() {
        return this._shift_times;
    }

    setShift(idx) {
        if (this._staff.length > 0) {
            return
        }
        this._shift_times = templates[idx].shift_times;
        const shift_select = new bootstrap.Collapse(document.getElementById("shift_select"), { toggle: false });
        shift_select.hide();

        const staff_select = new bootstrap.Collapse(document.getElementById("staff_select"), { toggle: false });
        staff_select.show();

        const position_select = new bootstrap.Collapse(document.getElementById("position_select"), { toggle: false });
        position_select.show();

        this.toTable();
    }

    get staff() {
        return this._staff;
    }

    addStaff(shift) {
        if (this._shift_times.length === 0) {
            return;
        }

        // todo adjust existing constraints staff params

        this._staff.push(new Staff(shift, this._shift_times.length - 1));
        this.sortStaff();
        this.toTable();
    }

    addStaffFromJson(json) {
        if (this._shift_times.length === 0) {
            return;
        }
        const staff = Staff.fromJson(json);
        if (staff.fixed_positions.length !== this._shift_times.length - 1) {
            console.error("Staff fixed positions length does not match shift times length.");
            return;
        }

        // todo adjust existing constraints staff params

        this._staff.push(staff);
        this.sortStaff();
        this.toTable();
    }

    removeStaff(idx) {
        if (idx > -1 && idx < this._staff.length) {
            // todo adjust existing constraints staff params
            this._staff.splice(idx, 1);
            this.toTable();
        }
    }

    sortStaff() {
        this._staff.sort((a, b) => {
            const idxA = global_vars["shift_sort_order"].indexOf(a.shift[0]);
            const idxB = global_vars["shift_sort_order"].indexOf(b.shift[0]);
            if (idxA === -1 || idxB === -1) {
                return 0; // If shift not found, keep original order
            }

            if (idxA == idxB) {
                return a.shift.localeCompare(b.shift); // Sort by name if shifts are the same

            }

            return idxA - idxB;
        });
    }

    setStaffShift(idx, shift) {
        if (idx > -1 && idx < this._staff.length) {
            this._staff[idx].shift = shift;
            this.toTable();
        }
    }

    addCustomPosition(name) {
        if (name in this._positions) {
            return
        }
        all_positions.push(name);
        this._positions[name] = new Position(this._shift_times.length - 1);
    }

    get positions() {
        return this._positions;
    }

    updatePosition(name) {
        if (this._shift_times.length > 0) {
            if (name in this._positions) {
                delete this._positions[name];
            } else {
                this._positions[name] = new Position(this._shift_times.length - 1);
            }

            this.toTable();
        }

        const position_select = document.getElementById("position_select");
        position_select.querySelectorAll(`input[type="checkbox"][name="position"]`).forEach((el) => {
            el.checked = el.value in this._positions;
        });
    }

    updateDemand(name, idx, value) {
        if (name in this._positions) {
            this._positions[name].setDemand(idx, value);
        }
    }

    sortedPositions() {
        return Object.keys(this._positions).sort((a, b) =>
            all_positions.indexOf(a) - all_positions.indexOf(b)
        );
    }

    get gap_ratio() {
        return this._gap_ratio;
    }

    set gap_ratio(gap_ratio) {
        this._gap_ratio = gap_ratio;
    }

    get constraints() {
        return this._constraints;
    }

    addConstraint(type) {
        if (this._shift_times.length === 0) {
            console.error("Cannot add constraint: No shift times defined.");
            return;
        }

        if (this._staff.length === 0) {
            console.error("Cannot add constraint: No staff defined.");
            return;
        }

        let constraint;
        if (type === "one_set") {
            constraint = new OneSetConstraint();
        } else if (type === "sum") {
            constraint = new SumConstraint();
        } else {
            console.error("Unknown constraint type:", type);
            return;
        }

        this._constraints.push(constraint);
        this.toConstraintsTable();
    }

    updateConstraint(idx, params, update = false) {
        if (idx < 0 || idx >= this._constraints.length) {
            console.error("Invalid constraint index:", idx);
            return;
        }

        const constraint = this._constraints[idx];
        constraint.updateParams(params);

        // Update the constraints table
        if (update) {
            this.toConstraintsTable();
        }
    }

    toConstraintsTable() {
        const constraintsTable = document.getElementById("constraint_table");
        constraintsTable.innerHTML = ""; // Clear existing constraints

        if (this._constraints.length === 0) {
            return;
        }

        const table = document.createElement("table");
        table.className = "table table-bordered text-center align-middle mt-3";
        table.innerHTML = "<thead><tr><th width='80px'>Type</th><th>Staff</th><th>Position</th><th width='80px'>Time</th><th width='750px'>Parameters</th><th width='120px'>Actions</th></tr></thead>";
        const tbody = document.createElement("tbody");
        this._constraints.forEach((constraint, idx) => {
            if (typeof constraint.toRow === "function") {
                const row = constraint.toRow(idx);
                tbody.appendChild(row);
            }
        });
        table.appendChild(tbody);
        constraintsTable.appendChild(table);
        constraintsTable.addEventListener("click", (e) => {
            if (e.target.tagName === "BUTTON" && e.target.innerHTML == "remove") {
                const idx = parseInt(e.target.dataset.idx);
                this._constraints.splice(idx, 1);
                this.toConstraintsTable();
            }
        });
    }

    toTable() {
        const sortedPositions = Object.keys(this._positions).sort((a, b) =>
            all_positions.indexOf(a) - all_positions.indexOf(b)
        );

        let table = "<table class='table-bordered'><thead><tr><th colspan='2' class='span-col'></th>";

        for (let i = 0; i < this._shift_times.length - 1; i++) {
            table += `<th class="time-col">${this._shift_times[i]}<br>${this._shift_times[i + 1]}</th>`;
        }
        table += "</tr></thead>";

        table += "<tbody>";
        for (const [staffIdx, staff] of this._staff.entries()) {
            table += `<tr class="staff-row"><td class="shift-col" data-bs-toggle="modal" data-bs-target="#staffModal" data-bs-staff-idx="${staffIdx}"><div class="m-0${(staff.rating.length > 0 ? " rating-highlight" : "")}" data-bs-toggle="tooltip" data-bs-title="${staff.rating.join(", ")}" data-bs-placement="left">${staff.shift}</div></td><td class="name-col"><input type="text" class="form-control" value="${staff.name}" tabindex="${staffIdx + 1}" placeholder="Staff ${staffIdx + 1}" data-staff-idx="${staffIdx}"></td>`
            for (let i = 0; i < this._shift_times.length - 1; i++) {
                if (!staff.validSession([this._shift_times[i], this._shift_times[i + 1]])) {
                    staff.fixed_positions[i] = "";
                    table += `<td>————</td>`;
                } else {
                    if (staff.fixed_positions[i] != "" && staff.fixed_positions[i] != "Break" && staff.fixed_positions[i] != "(Work)" && (!staff.fixed_positions[i] in this._positions || this._positions[staff.fixed_positions[i]].demand[i] == 0)) {
                        staff.fixed_positions[i] = "";
                    }

                    let staff_position_select = `<select class="form-select no-arrow position-select" onchange="config.staff[${staffIdx}].setFixedPosition(${i}, this.value); this.blur()" tabindex="${(staffIdx + 1) * 100 + i}">`;
                    staff_position_select += `<option value=""></option>`;
                    staff_position_select += `<option value="Break" ${staff.fixed_positions[i] == "Break" ? "selected" : ""}>Break</option>`;
                    staff_position_select += `<option value="(Work)" ${staff.fixed_positions[i] == "(Work)" ? "selected" : ""}>(Work)</option>`;
                    for (const position of sortedPositions) {
                        if (this._positions[position].demand[i] == 0 || (staff.rating.length > 0 && !staff.rating.includes(position))) {
                            continue;
                        }
                        staff_position_select += `<option value="${position}" ${staff.fixed_positions[i] == position ? "selected" : ""}>${position}</option>`;
                    }
                    staff_position_select += `</select>`;
                    table += `<td>${staff_position_select}</td>`;
                }
            }
            table += "</tr>";
        }

        for (const name of sortedPositions) {
            table += `<tr class="position-row"><td colspan="2">${name}</td>`
            for (let i = 0; i < this._shift_times.length - 1; i++) {
                table += `<td class="demand-cell" data-position="${name}" data-index="${i}" data-value="${this._positions[name].demand[i]}">${this._positions[name].demand[i] > 0 ? '✓' : ""}</td>`;
            }
            table += "</tr>";
        }
        table += "</tbody></table>";
        document.getElementById("setup_table").innerHTML = table;

        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]:not([data-bs-title=""])')
        if (tooltipTriggerList.length > 0) {
            [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
        }

        this.toConstraintsTable();
    }

    toJson() {
        let obj = {}
        obj.num_employees = this._staff.length;
        obj.max_continous_work = global_vars["max_continous_work"] || 4;
        obj.positions = Object.keys(this._positions).sort((a, b) =>
            all_positions.indexOf(a) - all_positions.indexOf(b)
        );

        obj.fixed_assignments = [];

        obj.cover_demands = [];
        for (let sessionIdx = 0; sessionIdx < this._shift_times.length - 1; sessionIdx++) {
            let sessionDemand = [];
            for (const position of obj.positions) {
                sessionDemand.push(this._positions[position].demand[sessionIdx]);
            }
            obj.cover_demands.push(sessionDemand);
        }

        obj.constraints = {};
        obj.rating_constraints = [];

        // staff
        for (const [staffIdx, staff] of this._staff.entries()) {
            // rating constraints
            if (staff.rating.length > 0) {
                for (let i = 1; i < obj.positions.length; i++) {
                    if (staff.rating.includes(obj.positions[i - 1])) {
                        obj.rating_constraints.push([staffIdx, i]);
                    }
                }
            }

            // fixed assignment
            for (const [sessionIdx, position] of staff.fixed_positions.entries()) {
                // force "break" if outside of shift
                //if (global_vars.shifts[staff.shift]["start"] > this._shift_times[sessionIdx] || global_vars.shifts[staff.shift]["end"] < this._shift_times[sessionIdx + 1]) {
                if (!staff.validSession([this._shift_times[sessionIdx], this._shift_times[sessionIdx + 1]])) {
                    obj.fixed_assignments.push([staffIdx, 0, sessionIdx]);
                    continue;
                }

                // skip empty position selection
                if (position === "") {
                    continue;
                }

                // set fixed assignment
                if (position === "Break") {
                    obj.fixed_assignments.push([staffIdx, 0, sessionIdx]);
                } else if (position === "(Work)") {
                    obj.fixed_assignments.push([staffIdx, -1, sessionIdx]);
                } else {
                    let positionIdx = obj.positions.indexOf(position);
                    if (positionIdx != -1) {
                        obj.fixed_assignments.push([staffIdx, positionIdx + 1, sessionIdx]);
                    }
                }
            }
        }

        // todo add configuration options
        obj.gap_ratio = this._gap_ratio;
        obj.weights = {
            "break_evenness": 100,
            "long_break": 25,
            "long_session": 50,
            "position_evenness": 10,
            "short_break": 0,
            "short_session": 50
        }

        // constraints

        for (const constraint of this._constraints) {
            if (constraint.type === "one_set") {
                if (!("one_set" in obj.constraints)) {
                    obj.constraints["one_set"] = [];
                }
                obj.constraints["one_set"].push(constraint.toJson());
            } else if (constraint.type === "sum") {
                if (!("sum_constraints" in obj.constraints)) {
                    obj.constraints["sum_constraints"] = [];
                }
                obj.constraints["sum_constraints"].push(constraint.toJson());
            }
        }

        console.log(JSON.stringify(obj, "", 2));
        return obj;
    }
}

class Staff {
    constructor(shift, length) {
        this._shift = shift;
        this._name = '';
        this._rating = [];
        this._fixed_positions = Array(length).fill("");
    }

    static fromJson(json) {
        const staff = new Staff(json._shift, json._fixed_positions.length);
        staff._name = json._name || '';
        staff._rating = json._rating || [];
        staff._fixed_positions = json._fixed_positions || Array(json._fixed_positions.length).fill("");
        return staff;
    }

    get shift() {
        return this._shift;
    }

    set shift(shift) {
        this._shift = shift;
    }

    get name() {
        return this._name;
    }

    set name(name) {
        this._name = name;
    }

    get rating() {
        return this._rating;
    }

    set rating(rating) {
        this._rating = rating;
    }

    get fixed_positions() {
        return this._fixed_positions;
    }

    setFixedPosition(idx, position) {
        if (idx >= 0 && idx < this._fixed_positions.length) {
            this._fixed_positions[idx] = position;
        }
    }

    addRating(rating) {
        this._rating.push(rating);
    }

    removeRating(rating) {
        const index = this._rating.indexOf(rating);
        if (index > -1) {
            this._rating.splice(index, 1);
        }
    }

    validSession(sessionTime) {
        if (sessionTime.length != 2) {
            console.error("Invalid session time format. Expected an array of two elements.");
            return false;
        }
        const start = sessionTime[0];
        const end = sessionTime[1];
        const shiftStart = global_vars.shifts[this._shift]["start"];
        const shiftEnd = global_vars.shifts[this._shift]["end"];

        return start >= shiftStart && end <= shiftEnd;
    }
}

class Position {
    constructor(length) {
        this._demand = Array(length).fill(1);
    }

    get demand() {
        return this._demand;
    }

    setDemand(idx, value) {
        if (idx >= 0 && idx < this._demand.length) {
            this._demand[idx] = value;
        }
    }
}

class Constraint {
    constructor(type, params = {}) {
        this._type = type;
        this._params = params; // Parameters specific to the constraint type
        this._enabled = true
    }

    // todo
    // static fromJson(json) {
    //     return new Constraint(json.type, json.params);
    // }

    get type() {
        return this._type;
    }

    get params() {
        return this._params;
    }

    get enabled() {
        return this._enabled;
    }

    set enabled(value) {
        this._enabled = value;
    }

    updateParams(params) {
        for (const key in params) {
            if (key in this._params) {
                this._params[key] = params[key];
            } else {
                console.warn(`Parameter ${key} does not exist in constraint type ${this._type}`);
            }
        }
    }

    timeSelect(idx) {
        const startTimeSelect = document.createElement("select");
        startTimeSelect.className = "form-select no-arrow";
        startTimeSelect.dataset.idx = idx;
        startTimeSelect.dataset.param = "start_time";
        for (let i = 0; i < config.shift_times.length - 1; i++) {
            const option = document.createElement("option");
            option.value = config.shift_times[i];
            option.textContent = config.shift_times[i];
            if (option.value == this._params["start_time"]) {
                option.setAttribute("selected", "");
            }
            startTimeSelect.appendChild(option);
        }

        const endTimeSelect = document.createElement("select");
        endTimeSelect.className = "form-select no-arrow";
        endTimeSelect.dataset.idx = idx;
        endTimeSelect.dataset.param = "end_time";
        for (let i = 1; i < config.shift_times.length; i++) {
            const option = document.createElement("option");
            option.value = config.shift_times[i];
            option.textContent = config.shift_times[i];
            if (option.value == this._params["end_time"]) {
                option.setAttribute("selected", "");
            }
            endTimeSelect.appendChild(option);
        }

        return [startTimeSelect, endTimeSelect]
    }

    staffSelect(idx) {
        const div = document.createElement("div");


        const allStaffCheckbox = document.createElement("input");
        allStaffCheckbox.type = "checkbox";
        allStaffCheckbox.className = "form-check-input";
        allStaffCheckbox.dataset.idx = idx;
        allStaffCheckbox.id = `allStaff-${idx}`;
        allStaffCheckbox.dataset.param = "allStaff";
        if (this._params["allStaff"]) {
            allStaffCheckbox.setAttribute("checked", "");
        }

        const allStaffLabel = document.createElement("label");
        allStaffLabel.className = "form-check-label";
        allStaffLabel.textContent += " All Staff";
        allStaffLabel.htmlFor = `allStaff-${idx}`;
        allStaffLabel.prepend(allStaffCheckbox);

        div.append(allStaffLabel);

        if (!this._params["allStaff"]) {
            const staffSelect = document.createElement("select");
            staffSelect.className = "form-select no-arrow";
            staffSelect.dataset.idx = idx;
            staffSelect.dataset.param = "staff";
            staffSelect.multiple = true;

            config.staff.forEach((staff, idx) => {
                const option = document.createElement("option");
                option.value = idx;
                option.textContent = staff.name || "Staff " + (idx + 1);
                if (this._params["staff"].includes(idx)) {
                    option.setAttribute("selected", "");
                }
                staffSelect.appendChild(option);
            });

            div.append(staffSelect);
        }

        return div;
    }

    positionSelect(idx) {
        const positionSelect = document.createElement("select");
        positionSelect.className = "form-select no-arrow";
        positionSelect.dataset.idx = idx;
        positionSelect.dataset.param = "position";

        const sortedPositions = config.sortedPositions();
        const breakOption = document.createElement("option");
        breakOption.value = "Break";
        breakOption.textContent = "Break";
        positionSelect.appendChild(breakOption);

        sortedPositions.forEach((position, i) => {
            const option = document.createElement("option");
            option.value = position;
            option.textContent = position;
            if (position === this._params["position"]) {
                option.setAttribute("selected", "");
            }
            positionSelect.appendChild(option);
        });

        return positionSelect;
    }
}

class OneSetConstraint extends Constraint {
    constructor() {
        super("one_set", { "name": "one_set", "allStaff": true, "staff": [], "position": "", "start_time": config.shift_times[0], "end_time": config.shift_times[1], "hard_min": 0, "soft_min": 0, "min_cost": 50, "hard_max": 0, "soft_max": 0, "max_cost": 0 });
    }

    toRow(idx) {
        const element = document.createElement("tr");
        element.classList.add("text-center");
        element.className = "constraint align-items-center";
        const [startTimeSelect, endTimeSelect] = super.timeSelect(idx);
        // Create table cells using DOM methods instead of string concatenation
        const tdType = document.createElement("td");
        tdType.textContent = "One Set";

        const tdStaff = document.createElement("td");
        tdStaff.appendChild(this.staffSelect(idx));

        const tdPosition = document.createElement("td");
        tdPosition.appendChild(this.positionSelect(idx));

        const tdTime = document.createElement("td");
        tdTime.appendChild(startTimeSelect);
        tdTime.appendChild(endTimeSelect);

        const tdParams = document.createElement("td");
        const rowDiv = document.createElement("div");
        rowDiv.className = "row";

        // hard_min
        const colHardMin = document.createElement("div");
        colHardMin.className = "col-2";
        const inputHardMin = document.createElement("input");
        inputHardMin.type = "range";
        inputHardMin.className = "form-range";
        inputHardMin.min = "0";
        inputHardMin.max = "10";
        inputHardMin.value = this._params["hard_min"];
        inputHardMin.setAttribute("data-idx", idx);
        inputHardMin.setAttribute("data-param", "hard_min");
        const outputHardMin = document.createElement("output");
        outputHardMin.setAttribute("data-idx", idx);
        outputHardMin.setAttribute("data-param", "hard_min");
        outputHardMin.textContent = `hard min: ${this._params["hard_min"]}`;
        colHardMin.appendChild(inputHardMin);
        colHardMin.appendChild(outputHardMin);
        rowDiv.appendChild(colHardMin);

        // soft_min
        const colSoftMin = document.createElement("div");
        colSoftMin.className = "col-2";
        const inputSoftMin = document.createElement("input");
        inputSoftMin.type = "range";
        inputSoftMin.className = "form-range";
        inputSoftMin.min = "0";
        inputSoftMin.max = "10";
        inputSoftMin.value = this._params["soft_min"];
        inputSoftMin.setAttribute("data-idx", idx);
        inputSoftMin.setAttribute("data-param", "soft_min");
        const outputSoftMin = document.createElement("output");
        outputSoftMin.setAttribute("data-idx", idx);
        outputSoftMin.setAttribute("data-param", "soft_min");
        outputSoftMin.textContent = `soft min: ${this._params["soft_min"]}`;
        colSoftMin.appendChild(inputSoftMin);
        colSoftMin.appendChild(outputSoftMin);
        rowDiv.appendChild(colSoftMin);

        // min_cost
        const colMinCost = document.createElement("div");
        colMinCost.className = "col-2";
        const inputMinCost = document.createElement("input");
        inputMinCost.type = "range";
        inputMinCost.className = "form-range";
        inputMinCost.min = "0";
        inputMinCost.max = "100";
        inputMinCost.step = "5";
        inputMinCost.value = this._params["min_cost"];
        inputMinCost.setAttribute("data-idx", idx);
        inputMinCost.setAttribute("data-param", "min_cost");
        const outputMinCost = document.createElement("output");
        outputMinCost.setAttribute("data-idx", idx);
        outputMinCost.setAttribute("data-param", "min_cost");
        outputMinCost.textContent = `min cost: ${this._params["min_cost"]}`;
        colMinCost.appendChild(inputMinCost);
        colMinCost.appendChild(outputMinCost);
        rowDiv.appendChild(colMinCost);

        tdParams.appendChild(rowDiv);

        const tdActions = document.createElement("td");
        const removeBtn = document.createElement("button");
        removeBtn.className = "btn btn-danger";
        removeBtn.setAttribute("data-idx", idx);
        removeBtn.textContent = "remove";
        tdActions.appendChild(removeBtn);

        // Append all tds to the row
        element.appendChild(tdType);
        element.appendChild(tdStaff);
        element.appendChild(tdPosition);
        element.appendChild(tdTime);
        element.appendChild(tdParams);
        element.appendChild(tdActions);
        return element;
    }

    toJson() {
        let params = [];
        let staffList = [];
        if (this._params["allStaff"]) {
            staffList = config.staff.map((_, idx) => idx);
        } else {
            staffList = this._params["staff"];
        }

        let position = config.sortedPositions().indexOf(this._params["position"])
        if (this._params["position"] == "Break") {
            position = 0;
        } else if (position !== -1) {
            position += 1; // Adjust for the 0-based index in the database
        } else {
            console.log(`Position "${this._params["position"]}" not found, defaulting to 0.`);
            position = 0; // Default to 0 if not found
        }

        params.push(staffList,
            config.shift_times.indexOf(this._params["start_time"]),
            config.shift_times.indexOf(this._params["end_time"]) - 1,
            position,
            parseInt(this._params["hard_min"]),
            parseInt(this._params["soft_min"]),
            parseInt(this._params["min_cost"]),
            this._params["name"],
        );

        return params;
    }
}

class SumConstraint extends Constraint {
    constructor() {
        super("sum", { "name": "sum", "allStaff": true, "staff": [], "position": "", "start_time": config.shift_times[0], "end_time": config.shift_times[1], "hard_min": 0, "soft_min": 0, "min_cost": 0, "hard_max": 0, "soft_max": 0, "max_cost": 0 });
    }

    toRow(idx) {
        const element = document.createElement("tr");
        element.classList.add("text-center");
        element.className = "constraint align-items-center";
        const [startTimeSelect, endTimeSelect] = super.timeSelect(idx);
        // Create table cells using DOM methods instead of string concatenation
        const tdType = document.createElement("td");
        tdType.textContent = "Sum";

        const tdStaff = document.createElement("td");
        tdStaff.appendChild(this.staffSelect(idx));

        const tdPosition = document.createElement("td");
        tdPosition.appendChild(this.positionSelect(idx));

        const tdTime = document.createElement("td");
        tdTime.appendChild(startTimeSelect);
        tdTime.appendChild(endTimeSelect);

        const tdParams = document.createElement("td");
        const rowDiv = document.createElement("div");
        rowDiv.className = "row";

        // hard_min
        const colHardMin = document.createElement("div");
        colHardMin.className = "col";
        const inputHardMin = document.createElement("input");
        inputHardMin.type = "range";
        inputHardMin.className = "form-range";
        inputHardMin.min = "0";
        inputHardMin.max = "10";
        inputHardMin.value = this._params["hard_min"];
        inputHardMin.setAttribute("data-idx", idx);
        inputHardMin.setAttribute("data-param", "hard_min");
        const outputHardMin = document.createElement("output");
        outputHardMin.setAttribute("data-idx", idx);
        outputHardMin.setAttribute("data-param", "hard_min");
        outputHardMin.textContent = `hard min: ${this._params["hard_min"]}`;
        colHardMin.appendChild(inputHardMin);
        colHardMin.appendChild(outputHardMin);
        rowDiv.appendChild(colHardMin);

        // soft_min
        const colSoftMin = document.createElement("div");
        colSoftMin.className = "col";
        const inputSoftMin = document.createElement("input");
        inputSoftMin.type = "range";
        inputSoftMin.className = "form-range";
        inputSoftMin.min = "0";
        inputSoftMin.max = "10";
        inputSoftMin.value = this._params["soft_min"];
        inputSoftMin.setAttribute("data-idx", idx);
        inputSoftMin.setAttribute("data-param", "soft_min");
        const outputSoftMin = document.createElement("output");
        outputSoftMin.setAttribute("data-idx", idx);
        outputSoftMin.setAttribute("data-param", "soft_min");
        outputSoftMin.textContent = `soft min: ${this._params["soft_min"]}`;
        colSoftMin.appendChild(inputSoftMin);
        colSoftMin.appendChild(outputSoftMin);
        rowDiv.appendChild(colSoftMin);

        // min_cost
        const colMinCost = document.createElement("div");
        colMinCost.className = "col";
        const inputMinCost = document.createElement("input");
        inputMinCost.type = "range";
        inputMinCost.className = "form-range";
        inputMinCost.min = "0";
        inputMinCost.max = "100";
        inputMinCost.step = "5";
        inputMinCost.value = this._params["min_cost"];
        inputMinCost.setAttribute("data-idx", idx);
        inputMinCost.setAttribute("data-param", "min_cost");
        const outputMinCost = document.createElement("output");
        outputMinCost.setAttribute("data-idx", idx);
        outputMinCost.setAttribute("data-param", "min_cost");
        outputMinCost.textContent = `min cost: ${this._params["min_cost"]}`;
        colMinCost.appendChild(inputMinCost);
        colMinCost.appendChild(outputMinCost);
        rowDiv.appendChild(colMinCost);

        // soft_max
        const colSoftMax = document.createElement("div");
        colSoftMax.className = "col";
        const inputSoftMax = document.createElement("input");
        inputSoftMax.type = "range";
        inputSoftMax.className = "form-range";
        inputSoftMax.min = "0";
        inputSoftMax.max = "10";
        inputSoftMax.value = this._params["soft_max"];
        inputSoftMax.setAttribute("data-idx", idx);
        inputSoftMax.setAttribute("data-param", "soft_max");
        const outputSoftMax = document.createElement("output");
        outputSoftMax.setAttribute("data-idx", idx);
        outputSoftMax.setAttribute("data-param", "soft_max");
        outputSoftMax.textContent = `soft max: ${this._params["soft_max"]}`;
        colSoftMax.appendChild(inputSoftMax);
        colSoftMax.appendChild(outputSoftMax);
        rowDiv.appendChild(colSoftMax);

        // hard_max
        const colHardMax = document.createElement("div");
        colHardMax.className = "col";
        const inputHardMax = document.createElement("input");
        inputHardMax.type = "range";
        inputHardMax.className = "form-range";
        inputHardMax.min = "0";
        inputHardMax.max = "10";
        inputHardMax.value = this._params["hard_max"];
        inputHardMax.setAttribute("data-idx", idx);
        inputHardMax.setAttribute("data-param", "hard_max");
        const outputHardMax = document.createElement("output");
        outputHardMax.setAttribute("data-idx", idx);
        outputHardMax.setAttribute("data-param", "hard_max");
        outputHardMax.textContent = `hard max: ${this._params["hard_max"]}`;
        colHardMax.appendChild(inputHardMax);
        colHardMax.appendChild(outputHardMax);
        rowDiv.appendChild(colHardMax);

        // max_cost
        const colMaxCost = document.createElement("div");
        colMaxCost.className = "col";
        const inputMaxCost = document.createElement("input");
        inputMaxCost.type = "range";
        inputMaxCost.className = "form-range";
        inputMaxCost.min = "0";
        inputMaxCost.max = "100";
        inputMaxCost.step = "5";
        inputMaxCost.value = this._params["max_cost"];
        inputMaxCost.setAttribute("data-idx", idx);
        inputMaxCost.setAttribute("data-param", "max_cost");
        const outputMaxCost = document.createElement("output");
        outputMaxCost.setAttribute("data-idx", idx);
        outputMaxCost.setAttribute("data-param", "max_cost");
        outputMaxCost.textContent = `max cost: ${this._params["max_cost"]}`;
        colMaxCost.appendChild(inputMaxCost);
        colMaxCost.appendChild(outputMaxCost);
        rowDiv.appendChild(colMaxCost);

        tdParams.appendChild(rowDiv);

        const tdActions = document.createElement("td");
        const removeBtn = document.createElement("button");
        removeBtn.className = "btn btn-danger";
        removeBtn.setAttribute("data-idx", idx);
        removeBtn.textContent = "remove";
        tdActions.appendChild(removeBtn);

        // Append all tds to the row
        element.appendChild(tdType);
        element.appendChild(tdStaff);
        element.appendChild(tdPosition);
        element.appendChild(tdTime);
        element.appendChild(tdParams);
        element.appendChild(tdActions);

        return element;
    }

    toJson() {
        let params = [];
        let staffList = [];
        if (this._params["allStaff"]) {
            staffList = config.staff.map((_, idx) => idx);
        } else {
            staffList = this._params["staff"];
        }

        let position = config.sortedPositions().indexOf(this._params["position"])
        if (position === -1) {
            position = 0; // Default to 0 if not found
        } else {
            position += 1; // Adjust for the 0-based index in the database
        }

        params.push(staffList,
            position,
            config.shift_times.indexOf(this._params["start_time"]),
            config.shift_times.indexOf(this._params["end_time"]) - 1,
            parseInt(this._params["hard_min"]),
            parseInt(this._params["soft_min"]),
            parseInt(this._params["min_cost"]),
            parseInt(this._params["soft_max"]),
            parseInt(this._params["hard_max"]),
            parseInt(this._params["max_cost"]),
            this._params["name"],
        );

        return params;
    }
}