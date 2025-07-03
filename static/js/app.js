class CpsatSolver {
    constructor() {
        this.eventSource = null;
        this.solverId = null;
        this.initializeEventHandlers();
    }

    initializeEventHandlers() {
        // Form submission
        document.getElementById('solveBtn').addEventListener('click', (e) => {
            e.preventDefault();
            this.solveOptimization();
        });
    }

    async solveOptimization() {
        try {
            // Collect and validate form data
            const data = config.toJson();

            // Reset UI
            this.resetUI();
            this.showSolverStatus();

            // Disable solve button
            const solveButton = document.getElementById('solveBtn');
            solveButton.disabled = true;
            solveButton.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Solving...';

            // Send solve request
            const response = await fetch('/solve', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to start optimization');
            }

            const result = await response.json();
            this.solverId = result.solver_id;

            // Start listening for progress updates
            this.startProgressStream();

        } catch (error) {
            console.error('Error solving optimization:', error);
            this.showError(error.message);
            this.resetSolveButton();
        }
    }

    showSolverStatus() {
        document.getElementById('solverStatus').classList.remove('d-none');
    }

    resetUI() {
        // Hide all result sections
        document.getElementById('results').classList.add('d-none');
        document.getElementById('errorMessage').classList.add('d-none');
        document.getElementById('noSolutionMessage').classList.add('d-none');
        document.getElementById('solverStatus').classList.add('d-none');

        // Reset progress
        this.updateProgress(0, 0, 'initializing');
    }

    startProgressStream() {
        if (this.eventSource) {
            this.eventSource.close();
        }

        this.eventSource = new EventSource(`/progress/${this.solverId}`);

        this.eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Progress update:', data);
                this.handleProgressUpdate(data);
            } catch (error) {
                console.error('Error parsing progress data:', error);
            }
        };

        this.eventSource.onerror = (error) => {
            console.error('EventSource error:', error);
            this.eventSource.close();
            this.showError('Connection to solver lost');
            this.resetSolveButton();
        };
    }

    handleProgressUpdate(data) {
        if (data.error) {
            this.showError(data.error);
            this.resetSolveButton();
            return;
        }

        // Update progress
        this.updateProgress(data.progress || 0, parseInt(data.count) || 0, data.status || 'unknown');

        // Handle completion
        if (data.status === 'completed') {
            this.eventSource.close();
            this.handleSolutionComplete(data.result, data.positions);
            this.resetSolveButton();
        } else if (data.status === 'error') {
            this.eventSource.close();
            this.showError(data.error || 'Solver encountered an error');
            this.resetSolveButton();
        }
    }

    updateProgress(progress, count, status) {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const statusText = document.getElementById('statusText');

        progressBar.style.width = `${progress}%`;
        progressText.textContent = `${count > 0 ? `(${count} solutions) ` : ``}${Math.floor(progress)}%`;

        // Update status badge
        statusText.textContent = this.formatStatus(status);
        statusText.className = `badge ${this.getStatusBadgeClass(status)}`;
    }

    getStatusBadgeClass(status) {
        const classMap = {
            'initializing': 'bg-secondary',
            'solving': 'bg-primary',
            'completed': 'bg-success',
            'error': 'bg-danger',
            'interrupted': 'bg-warning',
        };
        return classMap[status] || 'bg-secondary';
    }

    handleSolutionComplete(result, positions) {
        if (!result) {
            this.showError('No result received from solver');
            return;
        }

        if (result.status === 'OPTIMAL' || result.status === 'FEASIBLE') {
            console.log('Solution found:', result);
            this.showResults(result, positions);
        } else {
            console.log('No solution found:', result);
            this.showNoSolution(result);
        }
    }

    showResults(result, positions) {
        const resultsDiv = document.getElementById('results');
        const resultContent = document.getElementById('resultContent');

        let table = "<table class='table-bordered'><thead><tr><th colspan='2' class='span-col'></th>";

        for (let i = 0; i < config._shift_times.length - 1; i++) {
            table += `<th class="time-col">${config.shift_times[i]}<br>${config.shift_times[i + 1]}</th>`;
        }
        table += "</tr></thead>";

        table += "<tbody>";
        for (const [staffIdx, staff] of config.staff.entries()) {
            table += `<tr class="staff-row"><td class="shift-col">${staff.shift}</td><td class="name-col">${staff.name || "Staff " + (staffIdx + 1)}</td>`
            for (let i = 0; i < config._shift_times.length - 1; i++) {
                if (global_vars.shifts[staff.shift]["start"] > config._shift_times[i] || global_vars.shifts[staff.shift]["end"] < config._shift_times[i + 1]) {
                    table += `<td>————</td>`;
                } else {
                    const position = result.solution[staffIdx][i]
                    if (position === 0) {
                        table += "<td></td>"
                    } else {
                        table += `<td>${positions[position - 1]}</td>`;
                    }
                }
            }
            table += "</tr>";
        }
        table += "</tbody></table>";

        resultContent.innerHTML = table;
        resultsDiv.classList.remove('d-none');
        resultsDiv.scrollIntoView();
    }

    showNoSolution(result) {
        const noSolutionDiv = document.getElementById('noSolutionMessage');
        const noSolutionContent = document.getElementById('noSolutionContent');

        noSolutionContent.innerHTML = `
            <p><strong>Status:</strong> ${result.status}</p>
            <p>${result.message || 'Unable to generate roster with current staff and positions.'}</p>
        `;

        noSolutionDiv.classList.remove('d-none');
    }

    formatStatus(status) {
        const statusMap = {
            'initializing': 'Initializing',
            'solving': 'Solving',
            'completed': 'Completed',
            'interrupted': 'Interrupted',
            'error': 'Error'
        };
        return statusMap[status] || status;
    }

    resetSolveButton() {
        const solveButton = document.getElementById('solveBtn');
        solveButton.disabled = false;
        solveButton.innerHTML = '<i class="fas fa-play me-2"></i>Generate';
    }

    showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        const errorContent = document.getElementById('errorContent');

        errorContent.innerHTML = `<p>${message}</p>`;
        errorDiv.classList.remove('d-none');

        statusText.textContent = this.formatStatus("error");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new CpsatSolver();

    const shift_select = document.getElementById("shift_select");
    if (shift_select) {
        shift_select.addEventListener('click', function (e) {
            if (e.target.dataset.type == "shift_select" && e.target.dataset.idx !== undefined) {
                e.preventDefault(); // Prevent default label click behavior
                config.setShift(e.target.dataset.idx);
            }
        });
    }

    const configResetBtn = document.getElementById('configResetBtn');
    configResetBtn.addEventListener('click', () => {
        config.reset();
    });

    const staff_select = document.getElementById("staff_select");
    if (staff_select) {
        staff_select.addEventListener('click', function (e) {
            if (e.target.dataset.type == "add_staff" && e.target.dataset.shift !== undefined) {
                config.addStaff(e.target.dataset.shift);
            }
        });
    }

    const staffModal = document.getElementById('staffModal')
    if (staffModal) {
        staffModal.addEventListener('show.bs.modal', event => {
            // Button that triggered the modal
            const button = event.relatedTarget
            // Extract info from data-bs-* attributes
            const staffIdx = parseInt(button.getAttribute('data-bs-staff-idx'))

            staffModalData.idx = staffIdx;
            staffModalData.shift = config.staff[staffIdx].shift || "";
            staffModalData.ratings = Array.from(config.staff[staffIdx].rating);

            // Update the modal's content.
            const modalRatings = staffModal.querySelector('#modalRatings')
            const modalTitle = staffModal.querySelector('#staffModalName')
            const staffModalRating = staffModal.querySelector('#staffModalRating')

            modalTitle.textContent = config.staff[staffIdx].name || `Staff ${parseInt(staffIdx) + 1}`

            modalRatings.innerHTML = ''; // Clear previous ratings

            for (const position of config.sortedPositions()) {
                let ratingButton = document.createElement('button');
                ratingButton.dataset.position = position;
                ratingButton.className = 'btn me-1';
                if (staffModalData.ratings.includes(position)) {
                    ratingButton.classList.add('btn-primary');
                } else {
                    ratingButton.classList.add('btn-secondary');
                }

                ratingButton.addEventListener('click', () => {
                    if (ratingButton.classList.contains('btn-primary')) {
                        ratingButton.classList.remove('btn-primary');
                        ratingButton.classList.add('btn-secondary');
                        // Remove position from ratings
                        staffModalData.ratings = staffModalData.ratings.filter(r => r !== position);
                    } else {
                        ratingButton.classList.remove('btn-secondary');
                        ratingButton.classList.add('btn-primary');
                        // Add position to ratings
                        if (!staffModalData.ratings.includes(position)) {
                            staffModalData.ratings.push(position);
                        }
                    }
                });

                ratingButton.textContent = position;

                modalRatings.appendChild(ratingButton);

            }

            modalRatings.hasChildNodes() ? staffModalRating.classList.remove('d-none') : staffModalRating.classList.add('d-none');

            const staffModalRemoveBtn = staffModal.querySelector('#staffModalRemoveBtn');
            staffModalRemoveBtn.dataset.staffIdx = staffIdx;

            staffModal.querySelectorAll('.shift-btn').forEach((btn) => {
                if (btn.dataset.shift === staffModalData.shift) {
                    btn.classList.add('btn-primary');
                    btn.classList.remove('btn-secondary');
                } else {
                    btn.classList.add('btn-secondary');
                    btn.classList.remove('btn-primary');
                }

                btn.addEventListener('click', () => {
                    // Update shift in modal data
                    staffModalData.shift = btn.dataset.shift;
                    // Update button styles
                    staffModal.querySelectorAll('.shift-btn').forEach((b) => {
                        b.classList.remove('btn-primary');
                        b.classList.add('btn-secondary');
                    });
                    btn.classList.add('btn-primary');
                    btn.classList.remove('btn-secondary');
                });
            })
        });

        staffModal.addEventListener('hidden.bs.modal', () => {
            // Reset modal data
            staffModalData.idx = -1;
            staffModalData.shift = "";
            staffModalData.ratings = [];
        });

        const staffModalRemoveBtn = staffModal.querySelector('#staffModalRemoveBtn');
        staffModalRemoveBtn.addEventListener('click', (e) => {
            config.removeStaff(e.target.dataset.staffIdx);
        });

        const staffModalSaveBtn = staffModal.querySelector('#staffModalSaveBtn');
        staffModalSaveBtn.addEventListener('click', () => {
            if (staffModalData.idx >= 0) {
                // Update existing staff
                const staff = config.staff[staffModalData.idx];
                staff.shift = staffModalData.shift;
                staff.rating = staffModalData.ratings;
                config.sortStaff();
            }
            config.toTable();
        });
    }

    document.querySelector(`#customPositionAddBtn`).addEventListener('click', () => {
        const positionName = document.querySelector(`#customPositionName`).value.trim();
        const customPositionDiv = document.querySelector(`#customPositions`);
        if (positionName && custom_positions.indexOf(positionName) === -1 && all_positions.indexOf(positionName) === -1) {
            if (config.shift_times.length > 0) {
                config.addCustomPosition(positionName);
            }
            document.querySelector(`#customPositionName`).value = '';
            customCheckbox = `<span class="position_checkbox">
                                        <label class="form-check-label">
                                            <input type="checkbox" class="form-check-input" name="position"
                                                onchange="config.updatePosition('${positionName}', this.checked)"
                                                value="${positionName}"> ${positionName}</label>
                                    </span>`

            customPositionDiv.innerHTML += customCheckbox
        }
    });

    const position_select = document.getElementById("position_select");
    if (position_select) {
        position_select.addEventListener('change', function (e) {
            if (e.target.tagName === "INPUT" && e.target.type === "checkbox") {
                e.preventDefault(); // Prevent default label click behavior
                config.updatePosition(e.target.value);
            }
        });
    }

    // Initialize positions checkboxes
    document.querySelectorAll(`input[name="position"]`).forEach((el) => {
        el.checked = this.value in config.positions;
    });

    const setup_table = document.getElementById("setup_table");
    if (setup_table) {
        setup_table.addEventListener('keydown', function (e) {
            if (e.target.tagName == "INPUT" && e.key === 'Enter') {
                e.preventDefault(); // Prevent form submission if inside a form

                // Get current tabindex
                const currentTabIndex = parseInt(e.target.getAttribute('tabindex'), 10);

                // Find next element with higher tabindex
                const next = [...document.querySelectorAll('[tabindex]')]
                    .filter(el => parseInt(el.getAttribute('tabindex'), 10) > currentTabIndex)
                    .sort((a, b) => a.tabIndex - b.tabIndex)[0];

                if (next) {
                    next.focus();
                } else {
                    e.target.blur();
                }
            }
        });

        setup_table.addEventListener("mousedown", (e) => {
            if (e.button == 0 && e.target.tagName === "TD" && e.target.classList.contains("demand-cell")) {
                dragging = true;
                lastDragValue = 1 - e.target.dataset["value"];

                config.updateDemand(e.target.dataset["position"], e.target.dataset["index"], 1 - e.target.dataset["value"]);
                config.toTable();
            }
        });

        setup_table.addEventListener("mouseover", (e) => {
            if (dragging && e.target.tagName === "TD" && e.target.classList.contains("demand-cell") && lastDragValue != e.target.dataset["value"]) {
                config.updateDemand(e.target.dataset["position"], e.target.dataset["index"], lastDragValue);
                config.toTable();
            }
        });

        setup_table.addEventListener("mouseup", () => {
            dragging = false;
        });

        setup_table.addEventListener("mouseleave", () => {
            dragging = false;
        });

        setup_table.addEventListener("blur", function (event) {
            if (event.target.tagName === "INPUT" && event.target.type === "text") {
                const input = event.target;
                const staffIdx = input.dataset.staffIdx;
                if (staffIdx !== undefined) {
                    config.staff[staffIdx].name = input.value;
                    config.toConstraintsTable();
                }
            }
        }, true);
    }

    document.getElementById("solveBtn").addEventListener("click", () => {
        config.toJson();
    });

    // document.getElementById("navSaveBtn").addEventListener("click", () => {
    //     localStorage.setItem("config", JSON.stringify(config));
    // });

    // document.getElementById("navLoadBtn").addEventListener("click", () => {
    //     const data = localStorage.getItem("config");
    //     if (data) {
    //         try {
    //             const loadedConfig = JSON.parse(data);
    //             config = Config.fromJson(loadedConfig);
    //         } catch (error) {
    //             console.error('Error loading configuration:', error);
    //             alert('Failed to load configuration. Please check the console for details.');
    //         }
    //     } else {
    //         alert('No saved configuration found.');
    //     }
    // });

    const constraint_table = document.getElementById("constraint_table");
    if (constraint_table) {
        constraint_table.addEventListener('input', (e) => {
            if (e.target.tagName === "INPUT" && e.target.type === "range") {
                e.preventDefault(); // Prevent default label click behavior
                const idx = e.target.dataset.idx;
                switch (e.target.dataset.param) {
                    case "hard_min":
                        const soft_min_range = constraint_table.querySelector(`input[data-idx="${idx}"][data-param="soft_min"]`);
                        soft_min_range.value = Math.max(soft_min_range.value, e.target.value); // Update the value to match the new min
                        config.updateConstraint(idx, { "hard_min": e.target.value, "soft_min": soft_min_range.value });
                        break;
                    case "soft_min":
                        const hard_min_range = constraint_table.querySelector(`input[data-idx="${idx}"][data-param="hard_min"]`);
                        e.target.value = Math.max(hard_min_range.value, e.target.value);
                        config.updateConstraint(idx, { "soft_min": e.target.value });
                        break;
                    case "soft_max":
                        const hard_max_range = constraint_table.querySelector(`input[data-idx="${idx}"][data-param="hard_max"]`);
                        hard_max_range.value = Math.max(hard_max_range.value, e.target.value);
                        config.updateConstraint(idx, { "soft_max": e.target.value, "hard_max": hard_max_range.value });
                        break;
                    case "hard_max":
                        const soft_max_range = constraint_table.querySelector(`input[data-idx="${idx}"][data-param="soft_max"]`);
                        e.target.value = Math.max(soft_max_range.value, e.target.value);
                        config.updateConstraint(idx, { "hard_max": e.target.value });
                        break;
                    case "min_cost":
                        config.updateConstraint(idx, { "min_cost": e.target.value });
                        break;
                    case "max_cost":
                        config.updateConstraint(idx, { "max_cost": e.target.value });
                        break;
                }

                const label = constraint_table.querySelectorAll(`output[data-idx="${idx}"]`)
                if (label) {
                    label.forEach((l) => {
                        const range = constraint_table.querySelector(`input[data-idx="${l.dataset.idx}"][data-param="${l.dataset.param}"]`);
                        l.textContent = `${l.dataset.param.replace("_", " ")}: ${range.value}`;
                    });
                }
            }
        })

        constraint_table.addEventListener('change', (e) => {
            if (e.target.tagName === "SELECT") {
                let param = {}
                if (e.target.multiple) {
                    let values = [];
                    for (let option of e.target.options) {
                        if (option.selected) {
                            if (e.target.dataset.param === "staff") {
                                values.push(parseInt(option.value));
                            } else {
                                values.push(option.value);
                            }
                        }
                    }
                    param[e.target.dataset.param] = values;
                } else {
                    switch (e.target.dataset.param) {
                        case "hard_min":
                        case "soft_min":
                        case "min_cost":
                        case "soft_max":
                        case "hard_max":
                        case "max_cost":
                            param[e.target.dataset.param] = parseInt(e.target.value);
                            break
                        default:
                            param[e.target.dataset.param] = e.target.value;
                    }

                }
                config.updateConstraint(e.target.dataset.idx, param);
            }

            if (e.target.tagName === "INPUT" && e.target.type === "checkbox") {
                let param = {}
                param[e.target.dataset.param] = e.target.checked;
                config.updateConstraint(e.target.dataset.idx, param, true);
            }
        });
    }

    const addConstraintBtn = document.getElementById("addConstraintButtons");
    if (addConstraintBtn) {
        addConstraintBtn.addEventListener("click", (e) => {
            if (e.target.tagName === "BUTTON") {
                e.preventDefault(); // Prevent default button behavior
                config.addConstraint(e.target.dataset.constraintType);
            }
        });
    }

    window.onbeforeunload = function (e) {
        e.preventDefault(); // Alert before tab close
    };
});


let dragging = false;
let lastDragValue;
let staffModalData = { idx: -1, shift: "", ratings: [] };
