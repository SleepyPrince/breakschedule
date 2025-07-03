import os
import logging
import json
import threading
import time

from flask import Flask, render_template, request, jsonify, Response
from solver import solve_shift_scheduling
from callback import ObjectiveEarlyStopping

# Configure logging for debugging
logging.basicConfig(level=logging.DEBUG)

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-secret-key")

# Global dictionary to store solver instances and their progress
active_solvers = {}
solver_lock = threading.Lock()


@app.route("/")
def index():
    """Main page with optimization problem input form"""
    with open("static/json/global.json", "r") as f:
        global_data = json.load(f)

    with open("static/json/template.json", "r") as f:
        template_data = json.load(f)

    return render_template(
        "index.html", global_data=global_data, template_data=template_data
    )


@app.route("/solve", methods=["POST"])
def solve_optimization():
    """Start solving optimization problem and return solver ID"""
    try:
        data = request.get_json()

        # Validate input data
        if not data:
            return jsonify({"error": "No data provided"}), 400

        num_employees = data.get("num_employees", 0)
        positions = data.get("positions", [])

        if num_employees < 1:
            return jsonify({"error": "No staff"}), 400
        if len(positions) < 1:
            return jsonify({"error": "No position"}), 400

        # Create solver instance
        # solver = OptimizationSolver(problem_type)
        solver_id = f"solver_{int(time.time() * 1000)}"

        with solver_lock:
            active_solvers[solver_id] = {
                "solver": None,
                "status": "initializing",
                "progress": 0,
                "result": None,
                "error": None,
                "thread": None,
                "positions": positions,
                "count": 0,
            }

        # Start solving in separate thread
        def solve_thread():
            try:
                with solver_lock:
                    active_solvers[solver_id]["status"] = "solving"

                callback = ObjectiveEarlyStopping(
                    15, data["gap_ratio"], active_solvers, solver_id, solver_lock
                )
                result = solve_shift_scheduling(
                    data, callback, active_solvers, solver_id, solver_lock
                )

                with solver_lock:
                    active_solvers[solver_id]["status"] = "completed"
                    active_solvers[solver_id]["result"] = result
                    active_solvers[solver_id]["progress"] = 100

            except Exception as e:
                logging.error(f"Solver error: {str(e)}")
                with solver_lock:
                    active_solvers[solver_id]["status"] = "error"
                    active_solvers[solver_id]["error"] = str(e)

        thread = threading.Thread(target=solve_thread)
        thread.daemon = True
        thread.start()

        return jsonify({"solver_id": solver_id})

    except Exception as e:
        logging.error(f"Error starting optimization: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/progress/<solver_id>")
def stream_progress(solver_id):
    """Stream solver progress using Server-Sent Events"""

    def generate():
        while True:
            try:
                with solver_lock:
                    if solver_id not in active_solvers:
                        yield f"data: {json.dumps({'error': 'Solver not found'})}\n\n"
                        break

                    solver_data = active_solvers[solver_id]
                    status = solver_data["status"]
                    progress = solver_data["progress"]

                    response_data = {
                        "status": status,
                        "progress": progress,
                        "solver_id": solver_id,
                        "positions": solver_data["positions"],
                        "count": solver_data["count"] or 0,
                    }

                    if status == "completed" and solver_data["result"]:
                        response_data["result"] = solver_data["result"]
                    elif status == "error" and solver_data["error"]:
                        response_data["error"] = solver_data["error"]

                    yield f"data: {json.dumps(response_data)}\n\n"

                    # Clean up completed or errored solvers
                    if status in ["completed", "error", "interrupted"]:
                        # Keep solver data for a bit longer for client to retrieve final result
                        threading.Timer(
                            30.0, lambda: active_solvers.pop(solver_id, None)
                        ).start()
                        break

                time.sleep(0.5)  # Update every 500ms

            except Exception as e:
                logging.error(f"Error in progress stream: {str(e)}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
                break

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.route("/result/<solver_id>")
def get_result(solver_id):
    """Get final result for a solver"""
    with solver_lock:
        if solver_id not in active_solvers:
            return jsonify({"error": "Solver not found"}), 404

        solver_data = active_solvers[solver_id]

        if solver_data["status"] == "completed":
            return jsonify({"status": "completed", "result": solver_data["result"]})
        elif solver_data["status"] == "error":
            return jsonify({"status": "error", "error": solver_data["error"]})
        else:
            return jsonify(
                {"status": solver_data["status"], "progress": solver_data["progress"]}
            )


@app.errorhandler(404)
def not_found(error):
    return render_template("index.html"), 404


@app.errorhandler(500)
def internal_error(error):
    logging.error(f"Internal server error: {str(error)}")
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
